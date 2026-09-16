/**
 * Pure helpers for binding an opening POS order to the right reservation.
 *
 * Two bugs this guards, both surfaced in the 2026-09-16 live demo:
 *
 *  1. TIMEZONE (#3 wrong reservation). findReservationAtTable compared the
 *     order's instant in **UTC minutes** against res.time, a **local** wall
 *     clock ("HH:MM"). Off by the UTC offset (2–3 h), the window check almost
 *     never matched, so it silently fell back to "the first reservation of the
 *     day" — the wrong one when a table has both a lunch and a dinner booking.
 *     Same family as the reserved_at +3h bug fixed 2026-09-15, on the match side.
 *
 *  2. BLIND FALLBACK (#1 walk-in). The old fallback bound *any* same-day
 *     reservation, so a walk-in seated at a table whose only booking is hours
 *     away was stamped with that reservation's identity. Now a candidate must be
 *     within a lead/grace band around now, else we return null and the order
 *     stays an unbound walk-in.
 *
 * All minute values are LOCAL wall-clock minutes since midnight.
 */

export interface ResCandidate {
  time: string; // "HH:MM" local wall clock
  duration: number; // minutes
}

/**
 * The local calendar day (YYYY-MM-DD) and minutes-since-midnight for a UTC
 * instant, in the given IANA zone. DST-aware (no library).
 */
export function localWallClock(
  at: Date,
  timeZone = 'Asia/Jerusalem',
): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  // Intl may render midnight as "24" for the hour in some environments.
  const hour = m.hour === '24' ? 0 : Number(m.hour);
  return { date: `${m.year}-${m.month}-${m.day}`, minutes: hour * 60 + Number(m.minute) };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Choose the reservation an opening order should bind to, given the candidate
 * reservations already filtered to (this table, today, CONFIRMED/SEATED,
 * posVisitId=null) and the order's LOCAL minutes-since-midnight.
 *
 *  1. A reservation whose [start, start+duration) window contains `atMinutes`.
 *  2. Otherwise the nearest reservation within [start - leadMin, end + graceMin]
 *     — covers early seating / order-before-seat and a little lingering.
 *  3. Otherwise null — a walk-in on a table with only a far-off booking is NOT
 *     bound to it.
 *
 * When several windows overlap `atMinutes`, the earliest-starting one wins
 * (deterministic); in the near-now band the closest start wins.
 */
export function pickReservationForOrder<T extends ResCandidate>(
  candidates: T[],
  atMinutes: number,
  opts: { leadMin?: number; graceMin?: number } = {},
): T | null {
  const lead = opts.leadMin ?? 30;
  const grace = opts.graceMin ?? 15;

  // 1) window contains now — prefer the earliest-starting containing window.
  let contain: T | null = null;
  let containStart = Infinity;
  for (const r of candidates) {
    const s = toMinutes(r.time);
    const e = s + r.duration;
    if (atMinutes >= s && atMinutes < e && s < containStart) {
      contain = r;
      containStart = s;
    }
  }
  if (contain) return contain;

  // 2) near-now band — closest start wins.
  let best: T | null = null;
  let bestDist = Infinity;
  for (const r of candidates) {
    const s = toMinutes(r.time);
    const e = s + r.duration;
    if (atMinutes >= s - lead && atMinutes < e + grace) {
      const dist = Math.abs(atMinutes - s);
      if (dist < bestDist) {
        bestDist = dist;
        best = r;
      }
    }
  }
  return best;
}
