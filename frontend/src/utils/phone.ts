/**
 * Normalize a phone number for consistent display and guest-search prefill.
 *
 * Rules applied in order:
 *   1. Strip whitespace, dashes, parentheses
 *   2. +972 → 0 (Israeli international to local)
 *
 * Does not normalize other country codes — safe to extend later.
 */
export function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-().]/g, '');
  if (stripped.startsWith('+972')) return '0' + stripped.slice(4);
  return stripped;
}
