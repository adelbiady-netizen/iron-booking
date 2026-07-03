import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../api';
import type { Reservation } from '../../../../types';
import { deriveDashboard, type DashboardData } from './model';

// Assembles the dashboard from EXISTING endpoints only (today's reservations +
// waitlist + table count + same-weekday-last-week for pace). Degrades gracefully:
// only today's reservations are required; everything else is best-effort.

type State =
  | { status: 'loading' }
  | { status: 'ready'; data: DashboardData }
  | { status: 'error'; message: string };

function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const ACTIVE = new Set(['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED']);
function covers(list: Reservation[]): number {
  return list.filter(r => ACTIVE.has(r.status)).reduce((s, r) => s + r.partySize, 0);
}

export function useDashboardData(settings: Record<string, unknown> | null | undefined, firstNameHe: string) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    const now = new Date();
    const today = localDate(now);
    const lastWeek = localDate(new Date(now.getTime() - 7 * 86_400_000));

    Promise.allSettled([
      api.reservations.list({ date: today, limit: '300' }),
      api.waitlist.list(today),
      api.tables.list(),
      api.reservations.list({ date: lastWeek, limit: '300' }),
    ]).then(([resR, wlR, tblR, lastR]) => {
      if (resR.status !== 'fulfilled') {
        setState({ status: 'error', message: 'לא הצלחנו לטעון את נתוני היום.' });
        return;
      }
      const reservations = resR.value.data;
      const waitlist = wlR.status === 'fulfilled' ? wlR.value : [];
      const tableCount = tblR.status === 'fulfilled' ? tblR.value.length : null;
      const lastWeekCovers = lastR.status === 'fulfilled' ? covers(lastR.value.data) : null;

      setState({
        status: 'ready',
        data: deriveDashboard({ now, firstNameHe, reservations, waitlist, tableCount, lastWeekCovers, settings }),
      });
    });
  }, [settings, firstNameHe]);

  useEffect(() => { load(); }, [load]);

  return { state, reload: load };
}
