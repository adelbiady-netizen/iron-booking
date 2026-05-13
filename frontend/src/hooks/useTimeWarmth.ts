import { useState, useEffect } from 'react';

// Continuous 0.0–1.0 warmth signal driven by clock hour.
// 0.0 = cool morning clarity, 1.0 = peak dinner service warmth.
// Updates every minute so the atmosphere drifts naturally as service phases shift.
function computeWarmth(hour: number): number {
  if (hour < 11) return 0.0;
  if (hour < 13) return ((hour - 11) / 2) * 0.15;
  if (hour < 17) return 0.15;
  if (hour < 19) return 0.15 + ((hour - 17) / 2) * 0.85;
  if (hour < 21) return 1.0;
  if (hour < 23) return 1.0 - ((hour - 21) / 2) * 0.75;
  return 0.25;
}

export function useTimeWarmth(): number {
  const [warmth, setWarmth] = useState(() => computeWarmth(new Date().getHours()));

  useEffect(() => {
    const id = setInterval(() => setWarmth(computeWarmth(new Date().getHours())), 60_000);
    return () => clearInterval(id);
  }, []);

  return warmth;
}
