import { useState, useEffect } from 'react';

export interface Atmosphere {
  warmth:     number;  // 0.0→1.0  amber warmth (morning cool → dinner golden)
  brightness: number;  // 0.0→1.0  daylight quality (open → deep night)
  gridFade:   number;  // 0.0→1.0  grid suppression (0=visible, 1=gone)
}

// Computes all three signals from the current hour.
// Designed as a smooth continuous function with no sudden jumps.
// Service phases: morning → lunch → afternoon → golden hour → dinner → late night
function computeAtmosphere(hour: number): Atmosphere {
  const h = ((hour % 24) + 24) % 24;

  // ── Warmth: amber quality of the room's light ────────────────────────────
  let warmth: number;
  if      (h < 7)   warmth = 0.00;
  else if (h < 11)  warmth = ((h - 7)  / 4) * 0.12;
  else if (h < 13)  warmth = 0.12 + ((h - 11) / 2) * 0.06;
  else if (h < 17)  warmth = 0.18;
  else if (h < 19)  warmth = 0.18 + ((h - 17) / 2) * 0.82;
  else if (h < 21)  warmth = 1.00;
  else if (h < 23)  warmth = 1.00 - ((h - 21) / 2) * 0.75;
  else              warmth = 0.25;

  // ── Brightness: how open and architectural the space feels ───────────────
  let brightness: number;
  if      (h < 5)   brightness = 0.04;
  else if (h < 7)   brightness = 0.04 + ((h - 5)  / 2)  * 0.64;
  else if (h < 11)  brightness = 0.68 + ((h - 7)  / 4)  * 0.17;
  else if (h < 14)  brightness = 0.85 - ((h - 11) / 3)  * 0.05;
  else if (h < 17)  brightness = 0.80 - ((h - 14) / 3)  * 0.40;
  else if (h < 19)  brightness = 0.40 - ((h - 17) / 2)  * 0.32;
  else if (h < 22)  brightness = 0.08 - ((h - 19) / 3)  * 0.04;
  else              brightness = 0.04;

  // GridFade derived from brightness — more light = more architectural grid visible
  const gridFade = Math.max(0, Math.min(1, 1 - brightness * 1.18));

  return { warmth, brightness, gridFade };
}

export function useAtmosphere(): Atmosphere {
  const [atm, setAtm] = useState<Atmosphere>(() => computeAtmosphere(new Date().getHours()));

  useEffect(() => {
    const id = setInterval(() => setAtm(computeAtmosphere(new Date().getHours())), 60_000);
    return () => clearInterval(id);
  }, []);

  return atm;
}

// Keep for any external callers that only need warmth as a scalar.
export function useTimeWarmth(): number {
  return useAtmosphere().warmth;
}
