// Default SMS body text for the three templated message types — the SINGLE
// source of truth. These are the built-in defaults every restaurant uses unless
// it saves a custom template (see composeSms / smsTemplates.ts). Bilingual
// (he/en) by the guest's language. Kept here (not duplicated per call site) so a
// wording change lands everywhere at once.
//
// The party-size turn time (<=2 -> 90min, >=3 -> 120min) reaches these via the
// pre-formatted `duration` phrase — see baselineTurnMinutes in engine/opProfile.

import { formatDurationHe, formatDurationEn } from './duration';

// RESERVATION_RECEIVED — sent immediately when a new reservation is captured
// (host, phone, or online). No confirmation link.
export function buildReservationReceivedText(p: {
  guestName: string;
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
  lang: 'en' | 'he';
  duration?: number | null;
}): string {
  if (p.lang === 'he') {
    const durationLine = p.duration ? ` השולחן שמור לכם למשך ${formatDurationHe(p.duration)}.` : '';
    return `היי ${p.guestName}, קיבלנו את הזמנתך ל${p.restaurantName} בתאריך ${p.date} בשעה ${p.time} ל-${p.partySize} סועדים.${durationLine} נשמח לארח אתכם!`;
  }
  const durationLine = p.duration ? ` Your table is held for ${formatDurationEn(p.duration)}.` : '';
  return `Hi ${p.guestName}, we've received your reservation at ${p.restaurantName} for ${p.date} at ${p.time} for ${p.partySize} guests.${durationLine} We look forward to hosting you!`;
}

// CONFIRMATION_REQUEST — asks the guest to confirm attendance, with a link.
export function buildConfirmationRequestSmsText(
  r: { guestName: string; date: Date | string; time: string; partySize: number; guestLang?: string | null; duration?: number | null },
  restaurantName: string,
  confirmUrl: string,
): string {
  const lang = r.guestLang ?? 'he';
  const dateStr = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
  if (lang === 'he') {
    const durationLine = r.duration ? ` השולחן שמור למשך ${formatDurationHe(r.duration)}.` : '';
    return `שלום ${r.guestName}, נשמח לאישור הגעתך ל${restaurantName} בתאריך ${dateStr} בשעה ${r.time} ל-${r.partySize} סועדים.${durationLine} לאישור: ${confirmUrl}`;
  }
  const durationLine = r.duration ? ` Your table is held for ${formatDurationEn(r.duration)}.` : '';
  return `Hi ${r.guestName}, please confirm your arrival at ${restaurantName} on ${dateStr} at ${r.time} for ${r.partySize} guests.${durationLine} Confirm here: ${confirmUrl}`;
}

// REMINDER — day-of reminder with a confirmation link.
export function buildReminderSmsText(
  r: { guestName: string; time: string; guestLang?: string | null; duration?: number | null },
  restaurantName: string,
  confirmUrl: string,
): string {
  const lang = r.guestLang ?? 'he';
  if (lang === 'he') {
    const durationLine = r.duration ? ` השולחן שמור למשך ${formatDurationHe(r.duration)}.` : '';
    return `היי ${r.guestName}, מזכירים את הזמנתך ל${restaurantName} היום בשעה ${r.time}.${durationLine} לאישור ההגעה: ${confirmUrl}`;
  }
  const durationLine = r.duration ? ` Your table is held for ${formatDurationEn(r.duration)}.` : '';
  return `Hi ${r.guestName}, a reminder for your reservation at ${restaurantName} today at ${r.time}.${durationLine} Confirm your arrival: ${confirmUrl}`;
}
