import type { Reservation, WaitlistEntry } from '../../../../types';

// Pure derivation for the Today's Business dashboard (P0.3). No AI, no new data —
// everything is computed from existing reservations / waitlist / settings. Kept
// pure (data in → view model out) so it is testable and predictable.

export type AttentionTier = 'now' | 'soon' | 'nice';
export type ServicePhase = 'pre' | 'in' | 'post' | 'unknown';

export interface GuestMemory {
  guestName: string;
  visitCount?: number;
  isVip?: boolean;
  tags?: string[];
}

export interface AttentionItem {
  id: string;
  tier: AttentionTier;
  title: string;
  context?: string;
  actionLabel?: string;
  target?: string;      // module key to navigate to (component maps to onNavigate)
  memory?: GuestMemory; // VIP / birthday prep detail
}

export interface PulseNumbers {
  coversToday: number;
  seatedNow: number;
  freeTables: number | null;
  occupancyPct: number | null;
  nextArrival: { time: string; guestName: string; partySize: number } | null;
  waiting: { count: number; longestMin: number | null };
  flags: { vip: number; birthday: number; large: number };
  paceVsLastWeek: number | null; // today covers ÷ same weekday last week
}

export interface HealthNumbers {
  occupancyPct: number | null;
  confirmationRatePct: number | null;
  noShowTodayPct: number | null;
  avgPartySize: number | null;
}

export interface DashboardData {
  phase: ServicePhase;
  weekdayLabelHe: string;
  gmVoice: string;
  pulse: PulseNumbers;
  attention: AttentionItem[];
  health: HealthNumbers;
}

const LARGE_PARTY = 6;
const VIP_SOON_MIN = 120;
const WAIT_ALERT_COUNT = 5;
const WAIT_ALERT_MIN = 20;
const WEEKDAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const ACTIVE: ReadonlySet<string> = new Set(['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED']);
const UPCOMING: ReadonlySet<string> = new Set(['PENDING', 'CONFIRMED']);

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function isBirthday(r: Reservation): boolean { return !!r.birthday; }
function isVip(r: Reservation): boolean { return r.guest?.isVip === true; }
function firstName(name: string): string { return name.split(' ')[0] || name; }

function servicePhase(nowMin: number, settings: Record<string, unknown> | null | undefined): ServicePhase {
  const open = typeof settings?.openingHour === 'string' ? settings.openingHour : null;
  const close = typeof settings?.closingHour === 'string' ? settings.closingHour : null;
  if (!open || !close) return 'unknown';
  const o = toMin(open), c = toMin(close);
  if (nowMin < o) return 'pre';
  if (nowMin > c) return 'post';
  return 'in';
}

export function composeGmVoice(input: {
  phase: ServicePhase; firstNameHe: string; pulse: PulseNumbers; noShowToday: number;
}): string {
  const { phase, firstNameHe, pulse, noShowToday } = input;
  const hi = firstNameHe ? `${firstNameHe}, ` : '';
  const vip = pulse.flags.vip > 0 ? ` · ${pulse.flags.vip} VIP` : '';
  const wait = pulse.waiting.count >= WAIT_ALERT_COUNT ? ' · רשימת ההמתנה מתמלאת' : '';
  if (phase === 'pre') return `בוקר טוב ${firstNameHe}. ${pulse.coversToday} מוזמנים היום${vip}${wait}.`;
  if (phase === 'in')  return `${hi}באמצע השירות — ${pulse.seatedNow} יושבים כעת${pulse.waiting.count ? `, ${pulse.waiting.count} ממתינים` : ''}${vip}.`;
  if (phase === 'post') return `${hi}השירות הסתיים — ${pulse.coversToday} מוזמנים${noShowToday ? `, ${noShowToday} לא הגיעו` : ''}.`;
  return `${hi}${pulse.coversToday} מוזמנים היום${vip}${wait}.`;
}

export function deriveDashboard(input: {
  now: Date;
  firstNameHe: string;
  reservations: Reservation[];
  waitlist: WaitlistEntry[];
  tableCount: number | null;
  lastWeekCovers: number | null;
  settings: Record<string, unknown> | null | undefined;
}): DashboardData {
  const { now, firstNameHe, reservations, waitlist, tableCount, lastWeekCovers, settings } = input;
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const active = reservations.filter(r => ACTIVE.has(r.status));
  const upcoming = reservations
    .filter(r => UPCOMING.has(r.status) && toMin(r.time) >= nowMin)
    .sort((a, b) => toMin(a.time) - toMin(b.time));
  const seated = reservations.filter(r => r.status === 'SEATED');
  const noShow = reservations.filter(r => r.status === 'NO_SHOW');
  const pending = reservations.filter(r => r.status === 'PENDING');
  const confirmed = reservations.filter(r => r.status === 'CONFIRMED');

  const coversToday = active.reduce((s, r) => s + r.partySize, 0);
  const seatedTableIds = new Set(seated.map(r => r.tableId).filter(Boolean));
  const freeTables = tableCount != null ? Math.max(0, tableCount - seatedTableIds.size) : null;
  const occupancyPct = tableCount ? Math.round((seatedTableIds.size / tableCount) * 100) : null;

  const activeWaiting = waitlist.filter(w => !w.seatedAt);
  const longestMin = activeWaiting.length
    ? Math.max(...activeWaiting.map(w => Math.floor((now.getTime() - new Date(w.addedAt).getTime()) / 60000)))
    : null;

  const next = upcoming[0] ?? null;
  const pulse: PulseNumbers = {
    coversToday,
    seatedNow: seated.length,
    freeTables,
    occupancyPct,
    nextArrival: next ? { time: next.time, guestName: firstName(next.guestName), partySize: next.partySize } : null,
    waiting: { count: activeWaiting.length, longestMin },
    flags: {
      vip: active.filter(isVip).length,
      birthday: active.filter(isBirthday).length,
      large: active.filter(r => r.partySize >= LARGE_PARTY).length,
    },
    paceVsLastWeek: lastWeekCovers && lastWeekCovers > 0 ? coversToday / lastWeekCovers : null,
  };

  // ── Attention (Now → Soon → Nice) ──────────────────────────────────────────
  const attention: AttentionItem[] = [];

  if (!(typeof settings?.openingHour === 'string' && typeof settings?.closingHour === 'string')) {
    attention.push({ id: 'hours', tier: 'now', title: 'לא הוגדרו שעות פעילות להיום', context: 'ללא שעות, הזמנות אונליין עלולות לא לעבוד.', actionLabel: 'הגדר שעות', target: 'operations' });
  }

  const vipOrLargePending = pending.filter(r => isVip(r) || r.partySize >= LARGE_PARTY);
  if (vipOrLargePending.length > 0) {
    const top = vipOrLargePending.sort((a, b) => toMin(a.time) - toMin(b.time))[0];
    attention.push({
      id: 'pending-vip', tier: 'now',
      title: `${vipOrLargePending.length} הזמנות VIP/גדולות ממתינות לאישור`,
      context: `${firstName(top.guestName)} · ${top.partySize} סועדים · ${top.time}`,
      actionLabel: 'אשר עכשיו', target: 'operations',
      memory: { guestName: firstName(top.guestName), visitCount: top.guest?.visitCount, isVip: top.guest?.isVip, tags: top.guest?.tags },
    });
  }
  const otherPending = pending.length - vipOrLargePending.length;
  if (otherPending > 0) {
    attention.push({ id: 'pending', tier: 'soon', title: `${otherPending} הזמנות ממתינות לאישור`, actionLabel: 'פתח תפעול', target: 'operations' });
  }

  if (activeWaiting.length >= WAIT_ALERT_COUNT || (longestMin != null && longestMin >= WAIT_ALERT_MIN)) {
    attention.push({ id: 'waitlist', tier: 'soon', title: `רשימת המתנה — ${activeWaiting.length} ממתינים${longestMin != null ? `, הארוך ${longestMin} דק׳` : ''}`, actionLabel: 'פתח תפעול', target: 'operations' });
  }

  const vipSoon = upcoming.find(r => isVip(r) && toMin(r.time) - nowMin <= VIP_SOON_MIN);
  if (vipSoon) {
    attention.push({
      id: 'vip-soon', tier: 'nice',
      title: `אורח VIP מגיע בקרוב — ${firstName(vipSoon.guestName)}`,
      context: 'המלצה: הכן את השולחן המועדף שלו/ה מראש.',
      actionLabel: 'צפה באורח', target: 'guests',
      memory: { guestName: firstName(vipSoon.guestName), visitCount: vipSoon.guest?.visitCount, isVip: true, tags: vipSoon.guest?.tags },
    });
  }
  const bday = active.find(isBirthday);
  if (bday) {
    attention.push({
      id: 'birthday', tier: 'nice',
      title: `יום הולדת היום — ${firstName(bday.guestName)}`,
      context: 'המלצה: שלח ברכה או הכן הפתעה קטנה.',
      actionLabel: 'צפה באורח', target: 'guests',
      memory: { guestName: firstName(bday.guestName), visitCount: bday.guest?.visitCount, isVip: bday.guest?.isVip, tags: bday.guest?.tags },
    });
  }
  if (pulse.paceVsLastWeek != null && pulse.paceVsLastWeek < 0.8) {
    attention.push({ id: 'quiet', tier: 'nice', title: `היום שקט מהרגיל מול ${WEEKDAYS_HE[now.getDay()]} שעבר`, context: 'המלצה: שקול לפתוח חלון הזמנות נוסף.', actionLabel: 'זמינות', target: 'operations' });
  }

  const tierRank: Record<AttentionTier, number> = { now: 0, soon: 1, nice: 2 };
  attention.sort((a, b) => tierRank[a.tier] - tierRank[b.tier]);

  const health: HealthNumbers = {
    occupancyPct,
    confirmationRatePct: (confirmed.length + pending.length) > 0
      ? Math.round((confirmed.length / (confirmed.length + pending.length)) * 100) : null,
    noShowTodayPct: (active.length + noShow.length) > 0
      ? Math.round((noShow.length / (active.length + noShow.length)) * 100) : null,
    avgPartySize: active.length ? Math.round((coversToday / active.length) * 10) / 10 : null,
  };

  const phase = servicePhase(nowMin, settings);
  return {
    phase,
    weekdayLabelHe: WEEKDAYS_HE[now.getDay()],
    gmVoice: composeGmVoice({ phase, firstNameHe, pulse, noShowToday: noShow.length }),
    pulse,
    attention,
    health,
  };
}
