// Converts a seating duration (minutes) to a friendly natural-language phrase.
// Used in customer-facing SMS / WhatsApp messages.

export function formatDurationHe(minutes: number): string {
  if (minutes === 45)  return 'כ-45 דקות';
  if (minutes === 60)  return 'כשעה';
  if (minutes === 90)  return 'כשעה וחצי';
  if (minutes === 120) return 'כשעתיים';
  if (minutes === 150) return 'כשעתיים וחצי';
  if (minutes === 180) return 'כשלוש שעות';
  if (minutes === 210) return 'כשלוש שעות וחצי';
  if (minutes === 240) return 'כארבע שעות';
  if (minutes < 60)    return `כ-${minutes} דקות`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0)  return `כ-${h} שעות`;
  if (m === 30) return `כ-${h} שעות וחצי`;
  return `כ-${minutes} דקות`;
}

export function formatDurationEn(minutes: number): string {
  if (minutes < 60)        return `about ${minutes} minutes`;
  if (minutes === 60)      return 'about 1 hour';
  if (minutes % 60 === 0)  return `about ${minutes / 60} hours`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 30) return `about ${h} and a half hours`;
  return `about ${h}h ${m}m`;
}
