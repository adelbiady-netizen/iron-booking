import { prisma } from './prisma';
import { formatDurationHe, formatDurationEn } from './duration';

export interface SmsResult {
  success: boolean;
  to: string;
  body: string;
}

// ── Phone formatting ──────────────────────────────────────────────────────────
// Accepts: 05XXXXXXXX  |  +9725XXXXXXXX  |  9725XXXXXXXX
export function formatPhone(raw: string): string {
  const stripped = raw.replace(/[\s\-().]/g, '');

  if (stripped.startsWith('+')) {
    const digits = stripped.slice(1).replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) throw new Error(`Invalid phone number: "${raw}"`);
    return `+${digits}`;
  }

  const digits = stripped.replace(/\D/g, '');

  if (digits.startsWith('0') && digits.length === 10) return `+972${digits.slice(1)}`;
  if (digits.startsWith('972') && digits.length === 12) return `+${digits}`;

  throw new Error(
    `Cannot convert "${raw}" to international format. ` +
    `Expected Israeli 05XXXXXXXX, +972XXXXXXXXX, or 972XXXXXXXXX.`
  );
}

// ── Core WhatsApp dispatch ────────────────────────────────────────────────────
// Loads UltraMsg credentials from the restaurant record.
// If the restaurant has no credentials configured, logs a warning and no-ops.
export async function sendWhatsApp(restaurantId: string, phone: string, body: string): Promise<SmsResult> {
  const to = formatPhone(phone);

  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: { ultramsgInstanceId: true, ultramsgToken: true },
  });

  const instanceId = restaurant?.ultramsgInstanceId;
  const token      = restaurant?.ultramsgToken;

  if (!instanceId || !token) {
    throw new Error(`WhatsApp credentials not configured for this restaurant — message not sent to ${to}`);
  }

  let res: Response;
  try {
    res = await fetch(`https://api.ultramsg.com/${instanceId}/messages/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, to, body }),
    });
  } catch (err) {
    throw new Error(`WhatsApp request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    console.error(`[UltraMsg] HTTP ${res.status} — ${text}`);
    throw new Error(`WhatsApp delivery failed (HTTP ${res.status})`);
  }

  const json = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (json?.sent !== 'true' && json?.sent !== true) {
    console.error('[UltraMsg] Unexpected response:', JSON.stringify({ ...json, token: '[REDACTED]' }));
    throw new Error(`WhatsApp delivery failed: ${String(json?.message ?? 'unexpected provider response')}`);
  }

  console.log(`[UltraMsg] WhatsApp sent → ${to}`);
  return { success: true, to, body };
}

// ── Confirmation message templates ───────────────────────────────────────────

export interface ConfirmationMessagePayload {
  guestName:       string;
  restaurantName:  string;
  date:            string;   // ISO YYYY-MM-DD
  time:            string;   // HH:MM (24 h)
  partySize:       number;
  confirmationUrl: string;
  duration?:       number;   // minutes
}

function fmtDateHe(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function buildReservationConfirmationWhatsAppMessage(
  lang: 'en' | 'he',
  p: ConfirmationMessagePayload
): string {
  if (lang === 'he') {
    const durationLine = p.duration ? `השולחן יעמוד לרשותכם למשך ${formatDurationHe(p.duration)}\n` : '';
    return (
      `היי ${p.guestName},\n\n` +
      `נשמח לאשר את ההזמנה שלך ב־${p.restaurantName}\n\n` +
      `תאריך: ${fmtDateHe(p.date)}\n` +
      `שעה: ${p.time}\n` +
      `מספר אורחים: ${p.partySize}\n` +
      durationLine +
      `\nלאישור הגעה או ביטול:\n${p.confirmationUrl}`
    );
  }
  const durationLine = p.duration ? `Table held for: ${formatDurationEn(p.duration)}\n` : '';
  return (
    `Hi ${p.guestName},\n\n` +
    `Please confirm your reservation at ${p.restaurantName}\n\n` +
    `Date: ${p.date}\n` +
    `Time: ${p.time}\n` +
    `Guests: ${p.partySize}\n` +
    durationLine +
    `\nConfirm or cancel here:\n${p.confirmationUrl}`
  );
}

export async function sendConfirmationSms(
  restaurantId: string,
  phone: string,
  guestName: string,
  restaurantName: string,
  date: string,
  time: string,
  partySize: number,
  confirmUrl: string,
  lang: 'en' | 'he' = 'en',
  duration?: number,
): Promise<SmsResult> {
  const message = buildReservationConfirmationWhatsAppMessage(lang, {
    guestName,
    restaurantName,
    date,
    time,
    partySize,
    confirmationUrl: confirmUrl,
    duration,
  });
  return sendWhatsApp(restaurantId, phone, message);
}

// ── Waitlist acknowledgment templates ────────────────────────────────────────

export interface WaitlistMessagePayload {
  guestName:     string;
  restaurantName: string;
  date:          string;   // ISO YYYY-MM-DD
  partySize:     number;
  preferredTime: string;   // HH:MM (24 h)
  flexibleTime?: boolean;
}

export function buildWaitlistWhatsAppMessage(
  lang: 'en' | 'he',
  p: WaitlistMessagePayload
): string {
  const flexibleHe = p.flexibleTime ? '\nגמישות: ±שעה' : '';
  const flexibleEn = p.flexibleTime ? '\nFlexible: ±1 hour' : '';

  if (lang === 'he') {
    return (
      `היי ${p.guestName},\n\n` +
      `נרשמת לרשימת ההמתנה ב־${p.restaurantName}.\n\n` +
      `תאריך: ${fmtDateHe(p.date)}\n` +
      `מספר אורחים: ${p.partySize}\n` +
      `שעה מבוקשת: ${p.preferredTime}${flexibleHe}\n\n` +
      `ניצור איתך קשר אם יתפנה שולחן. תודה על הסבלנות.\n\n` +
      `— ${p.restaurantName}`
    );
  }
  return (
    `Hi ${p.guestName},\n\n` +
    `You're on the waitlist at ${p.restaurantName}.\n\n` +
    `Date: ${p.date}\n` +
    `Party: ${p.partySize} ${p.partySize === 1 ? 'guest' : 'guests'}\n` +
    `Preferred time: ${p.preferredTime}${flexibleEn}\n\n` +
    `We'll reach out if a table becomes available. Thank you for your patience.\n\n` +
    `— ${p.restaurantName}`
  );
}

// ── Reminder message ──────────────────────────────────────────────────────────
function buildReminderBody(
  lang: 'en' | 'he',
  guestName: string,
  restaurantName: string,
  time: string,
  confirmUrl: string,
  duration?: number,
): string {
  if (lang === 'he') {
    const durationLine = duration ? `השולחן יעמוד לרשותכם למשך ${formatDurationHe(duration)}.\n\n` : '\n';
    return (
      `היי ${guestName},\n\n` +
      `תזכורת להזמנה שלך ב־${restaurantName} היום בשעה ${time}.\n` +
      durationLine +
      `לאישור הגעה או ביטול:\n${confirmUrl}`
    );
  }
  const durationLine = duration ? `Your table will be held for ${formatDurationEn(duration)}.\n\n` : '\n';
  return (
    `Hi ${guestName},\n\n` +
    `Just a quick reminder about your reservation at ${restaurantName} today at ${time}.\n` +
    durationLine +
    `Please confirm your arrival here:\n${confirmUrl}`
  );
}

export async function sendReminderSms(
  restaurantId: string,
  phone: string,
  guestName: string,
  restaurantName: string,
  time: string,
  confirmUrl: string,
  lang: 'en' | 'he' = 'en',
  duration?: number,
): Promise<SmsResult> {
  const body = buildReminderBody(lang, guestName, restaurantName, time, confirmUrl, duration);
  return sendWhatsApp(restaurantId, phone, body);
}

// ── Reservation received notification ─────────────────────────────────────────
// Sent once, immediately after a manual host reservation is created.
// No confirmation link — this is an acknowledgment only.

export interface ReservationReceivedPayload {
  guestName:      string;
  restaurantName: string;
  date:           Date;    // Prisma @db.Date → UTC midnight
  time:           string;  // HH:MM 24h
  partySize:      number;
  status:         string;  // 'PENDING' | 'CONFIRMED'
}

function formatDayOfWeekHe(date: Date): string {
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  return `יום ${days[date.getUTCDay()]}`;
}

function formatDayOfWeekEn(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getUTCDay()];
}

export function buildReservationReceivedMessage(
  lang: 'en' | 'he',
  p: ReservationReceivedPayload
): string {
  const firstName = p.guestName.split(' ')[0];

  if (lang === 'he') {
    const day        = formatDayOfWeekHe(p.date);
    const guestsWord = p.partySize === 1 ? 'אורח' : 'אורחים';
    const statusLine = p.status === 'CONFIRMED'
      ? 'ההזמנה שלך מאושרת.'
      : 'נשלח אישור סופי בקרוב.';
    return (
      `שלום ${firstName} 👋\n` +
      `ההזמנה שלך התקבלה ב־${p.restaurantName}\n\n` +
      `${day} • ${p.time}\n` +
      `${p.partySize} ${guestsWord}\n\n` +
      statusLine
    );
  }

  const day        = formatDayOfWeekEn(p.date);
  const guestsWord = p.partySize === 1 ? 'guest' : 'guests';
  const statusLine = p.status === 'CONFIRMED'
    ? 'Your reservation is confirmed.'
    : 'A final confirmation will be sent soon.';
  return (
    `Hi ${firstName} 👋\n` +
    `Your reservation request was received by ${p.restaurantName}.\n\n` +
    `${day} • ${p.time}\n` +
    `${p.partySize} ${guestsWord}\n\n` +
    statusLine
  );
}

// Fetches restaurant name, then delegates to sendWhatsApp (which fetches credentials).
// Two lightweight SELECT queries — acceptable on the fire-and-forget path after the
// response has already been sent.
export async function sendReservationReceivedMessage(
  restaurantId: string,
  phone: string,
  lang: 'en' | 'he',
  payload: Omit<ReservationReceivedPayload, 'restaurantName'>
): Promise<SmsResult> {
  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: { name: true },
  });
  const restaurantName = restaurant?.name ?? '';
  const body = buildReservationReceivedMessage(lang, { ...payload, restaurantName });
  return sendWhatsApp(restaurantId, phone, body);
}
