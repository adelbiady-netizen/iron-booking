import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { z } from 'zod';
import * as service from './service';
import { prisma } from '../../lib/prisma';
import { ForbiddenError } from '../../lib/errors';

const router = Router();
router.use(authenticate);

// Helper: Express 5 types req.params values as string | string[] — route
// params from :id patterns are always plain strings at runtime.
function p(req: Request, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : (v as string);
}

const GuestSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  isVip: z.boolean().optional(),
  allergies: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  // Zod v4 requires both key and value schemas for z.record()
  preferences: z.record(z.string(), z.unknown()).optional(),
  internalNotes: z.string().optional(),
});

const SearchQuerySchema = z.object({
  search: z.string().optional(),
  isVip: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  isBlacklisted: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  tag: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

type SearchQuery = z.infer<typeof SearchQuerySchema>;

// GET /guests — guarded by:
//   1. restaurant feature flag (guestsPageEnabled, default true)
//   2. minimum role: MANAGER (HOST and SERVER are denied)
router.get('/', requireRole('MANAGER'), validate(SearchQuerySchema, 'query'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: req.auth.restaurantId },
      select: { settings: true },
    });
    const settings = (restaurant?.settings ?? {}) as Record<string, unknown>;
    if (settings.guestsPageEnabled === false) {
      throw new ForbiddenError('מודול אורחים לא פעיל');
    }
    const result = await service.searchGuests(req.auth.restaurantId, req.query as unknown as SearchQuery);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /guests
router.post('/', validate(GuestSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const guest = await service.createGuest(req.auth.restaurantId, req.body);
    res.status(201).json(guest);
  } catch (err) { next(err); }
});

// POST /guests/find-or-create
router.post('/find-or-create', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.findOrCreateGuest(req.auth.restaurantId, req.body);
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) { next(err); }
});

// GET /guests/lookup?phone=... — read-only phone lookup, never creates
router.get('/lookup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const phone = typeof req.query.phone === 'string' ? req.query.phone : '';
    const guest = await service.lookupGuestByPhone(req.auth.restaurantId, phone);
    res.json({ guest });
  } catch (err) { next(err); }
});

// GET /guests/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const guest = await service.getGuest(req.auth.restaurantId, p(req, 'id'));
    res.json(guest);
  } catch (err) { next(err); }
});

// PATCH /guests/:id
router.patch('/:id', validate(GuestSchema.partial()), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const guest = await service.updateGuest(req.auth.restaurantId, p(req, 'id'), req.body);
    res.json(guest);
  } catch (err) { next(err); }
});

// POST /guests/:id/merge — merge duplicate into primary
router.post('/:id/merge', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { duplicateId } = req.body;
    const result = await service.mergeGuests(req.auth.restaurantId, p(req, 'id'), duplicateId);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /guests/:id/consent-audit — consent history for a guest, scoped to this restaurant
router.get('/:id/consent-audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const guestId      = p(req, 'id');
    const restaurantId = req.auth.restaurantId;

    // Verify the guest belongs to this restaurant (prevents cross-tenant leakage)
    const guest = await prisma.guest.findFirst({
      where:  { id: guestId, restaurantId },
      select: { id: true },
    });
    if (!guest) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    const rows = await prisma.consentAudit.findMany({
      where:   { guestId, restaurantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id:                  true,
        consentType:         true,
        action:              true,
        source:              true,
        smsConsent:          true,
        marketingConsent:    true,
        emailConsent:        true,
        consentTextVersion:  true,
        ipAddress:           true,
        userAgent:           true,
        actorId:             true,
        notes:               true,
        createdAt:           true,
        clubMemberId:        true,
      },
    });

    // Privacy: partial-mask IP, summarise user-agent
    const sanitised = rows.map(r => ({
      ...r,
      ipAddress: r.ipAddress ? maskIp(r.ipAddress) : null,
      userAgent: r.userAgent ? summariseUA(r.userAgent) : null,
      createdAt: r.createdAt.toISOString(),
    }));

    return res.json({ data: sanitised });
  } catch (err) { next(err); }
});

// GET /guests/:id/consent-proof — downloadable HTML proof-of-consent document
router.get('/:id/consent-proof', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const guestId      = p(req, 'id');
    const restaurantId = req.auth.restaurantId;

    const guest = await prisma.guest.findFirst({
      where:  { id: guestId, restaurantId },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true, createdAt: true },
    });
    if (!guest) return res.status(404).json({ error: 'Guest not found' });

    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: restaurantId },
      select: { name: true },
    });

    const rows = await prisma.consentAudit.findMany({
      where:   { guestId, restaurantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, consentType: true, action: true, source: true,
        smsConsent: true, marketingConsent: true, emailConsent: true,
        ipAddress: true, userAgent: true, actorId: true, notes: true, createdAt: true,
      },
    });

    const sanitised = rows.map(r => ({
      ...r,
      ipAddress: r.ipAddress ? maskIp(r.ipAddress) : null,
      userAgent: r.userAgent ? summariseUA(r.userAgent) : null,
      createdAt: r.createdAt.toISOString(),
    }));

    const html = buildConsentProofHtml(guest, restaurant?.name ?? restaurantId, sanitised);
    const filename = `consent-proof-${guestId.slice(0, 8)}.html`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(html);
  } catch (err) { next(err); }
});

export default router;

// ── Privacy helpers ───────────────────────────────────────────────────────────

function maskIp(ip: string): string {
  // IPv4: show first two octets, mask the rest  →  "1.2.x.x"
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.x.x`;
  // IPv6: show first group only  →  "2001:x:x:…"
  if (ip.includes(':')) return ip.split(':')[0] + ':x:x:x:x:x:x:x';
  return '?.?.?.?';
}

function summariseUA(ua: string): string {
  if (/iPhone|iPad/.test(ua))   return 'iOS Safari';
  if (/Android/.test(ua))       return 'Android';
  if (/Chrome/.test(ua))        return 'Chrome';
  if (/Firefox/.test(ua))       return 'Firefox';
  if (/Safari/.test(ua))        return 'Safari';
  if (/curl|wget|axios|node/i.test(ua)) return 'API';
  return 'דפדפן';
}

// ── Consent proof HTML builder ────────────────────────────────────────────────

type SanitisedAuditRow = {
  id: string;
  consentType: string;
  action: string;
  source: string;
  smsConsent: boolean | null;
  marketingConsent: boolean | null;
  emailConsent: boolean | null;
  ipAddress: string | null;
  userAgent: string | null;
  actorId: string | null;
  notes: string | null;
  createdAt: string;
};

type GuestSummary = {
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  createdAt: Date;
};

function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ACTION_HE: Record<string, string> = {
  GRANTED: 'אישור', REVOKED: 'הסרה', UPDATED: 'עדכון',
};
const SOURCE_HE: Record<string, string> = {
  BOOKING_FLOW: 'הזמנה אונליין', CLUB_JOIN_FORM: 'טופס הצטרפות למועדון',
  FEEDBACK_FORM: 'טופס משוב', HOST_MANUAL: 'עדכון ידני',
  IMPORT: 'ייבוא נתונים', API: 'API', UNSUBSCRIBE_LINK: 'קישור הסרה',
};
const TYPE_HE: Record<string, string> = {
  SMS_MARKETING: 'SMS שיווקי', BIRTHDAY_SMS: 'SMS יום הולדת',
  ANNIVERSARY_SMS: 'SMS יום נישואין', SURVEY: 'סקר',
  CLUB_MEMBERSHIP: 'חברות במועדון', EMAIL_MARKETING: 'אימייל שיווקי',
};

function fmtIso(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function boolBadge(v: boolean | null): string {
  if (v === null) return '<span style="color:#888">—</span>';
  return v
    ? '<span style="color:#4ade80;font-weight:600">✓ כן</span>'
    : '<span style="color:#f87171;font-weight:600">✕ לא</span>';
}

function buildConsentProofHtml(
  guest: GuestSummary,
  restaurantName: string,
  rows: SanitisedAuditRow[],
): string {
  const generatedAt = fmtIso(new Date().toISOString());
  const memberSince  = fmtIso(guest.createdAt.toISOString());

  const timelineRows = rows.length === 0
    ? '<tr><td colspan="7" style="text-align:center;color:#888;padding:24px">אין היסטוריית הרשאות</td></tr>'
    : [...rows].reverse().map(r => `
        <tr>
          <td>${esc(fmtIso(r.createdAt))}</td>
          <td>${esc(TYPE_HE[r.consentType] ?? r.consentType)}</td>
          <td style="font-weight:600">${esc(ACTION_HE[r.action] ?? r.action)}</td>
          <td>${esc(SOURCE_HE[r.source] ?? r.source)}</td>
          <td>${boolBadge(r.smsConsent)} / ${boolBadge(r.marketingConsent)} / ${boolBadge(r.emailConsent)}</td>
          <td style="direction:ltr;text-align:left;font-size:11px;color:#aaa">${esc(r.ipAddress)}</td>
          <td style="font-size:11px;color:#aaa">${esc(r.userAgent)}</td>
          <td style="font-size:11px;color:#aaa">${esc(r.notes)}</td>
        </tr>`).join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>הוכחת הרשאה — ${esc(guest.firstName)} ${esc(guest.lastName)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #111; color: #e0e0e0; padding: 32px; direction: rtl; }
  @media print { body { background: #fff; color: #111; padding: 16px; } }
  .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
  @media print { .card { background: #f8f8f8; border-color: #ccc; } }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  h2 { font-size: 14px; font-weight: 600; color: #888; margin-bottom: 16px; }
  h3 { font-size: 13px; font-weight: 600; color: #aaa; margin-bottom: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .field label { font-size: 11px; color: #888; display: block; margin-bottom: 2px; }
  .field span { font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: right; padding: 8px 10px; border-bottom: 1px solid #2a2a2a; color: #888; font-weight: 600; font-size: 11px; }
  td { padding: 8px 10px; border-bottom: 1px solid #1e1e1e; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  @media print { th, td { border-color: #ddd; } }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .badge-green { background: rgba(74,222,128,.15); color: #4ade80; border: 1px solid rgba(74,222,128,.3); }
  .badge-red   { background: rgba(248,113,113,.12); color: #f87171; border: 1px solid rgba(248,113,113,.25); }
  footer { font-size: 11px; color: #555; text-align: center; margin-top: 32px; }
</style>
</head>
<body>

<div class="card">
  <h1>הוכחת הרשאה</h1>
  <h2>${esc(restaurantName)}</h2>
  <div class="grid2">
    <div class="field"><label>שם אורח</label><span>${esc(guest.firstName)} ${esc(guest.lastName)}</span></div>
    <div class="field"><label>טלפון</label><span>${esc(guest.phone) || '—'}</span></div>
    <div class="field"><label>אימייל</label><span>${esc(guest.email) || '—'}</span></div>
    <div class="field"><label>חבר מאז</label><span>${esc(memberSince)}</span></div>
    <div class="field"><label>הופק בתאריך</label><span>${esc(generatedAt)}</span></div>
    <div class="field"><label>מזהה אורח</label><span style="font-size:11px;font-family:monospace;color:#888">${esc(guest.firstName.toLowerCase())}-${esc(guest.lastName.toLowerCase())}</span></div>
  </div>
</div>

<div class="card">
  <h3>היסטוריית הרשאות</h3>
  <table>
    <thead>
      <tr>
        <th>תאריך</th>
        <th>סוג</th>
        <th>פעולה</th>
        <th>מקור</th>
        <th>SMS / שיווק / אימייל</th>
        <th style="direction:ltr;text-align:left">IP</th>
        <th>מכשיר</th>
        <th>הערות</th>
      </tr>
    </thead>
    <tbody>${timelineRows}</tbody>
  </table>
</div>

<footer>
  מסמך זה הופק אוטומטית על ידי מערכת Iron Booking · ${esc(generatedAt)} · המידע כפוף לתנאי הפרטיות של המסעדה
</footer>

</body>
</html>`;
}
