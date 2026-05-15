// ─── useGuestHub fetch hook ───────────────────────────────────────────────────
// Fetches a hub by slug. Returns a discriminated union so callers can handle
// loading / error / not_found / ready states explicitly.
//
// ISOLATION: no reservation, waitlist, floor, or SSE imports.

import { useState, useEffect } from 'react';
import { BASE } from '../../../api';
import type { GuestHubViewModel } from '../types/viewModel';
import { mapGuestHub, type ApiGuestHub } from '../mappers/hubMapper';

export type GuestHubState =
  | { status: 'loading' }
  | { status: 'error';     retry: () => void }
  | { status: 'not_found' }
  | { status: 'ready';     data: GuestHubViewModel };

// BASE is "https://iron-booking.onrender.com/api"
// Hub endpoint lives at /api/public/hub/:slug
const HUB_BASE = BASE.replace(/\/api$/, '');

export function useGuestHub(slug: string): GuestHubState {
  const [state,   setState]   = useState<GuestHubState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!slug) {
      setState({ status: 'not_found' });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading' });

    fetch(`${HUB_BASE}/api/public/hub/${encodeURIComponent(slug)}`)
      .then(res => {
        if (res.status === 404) {
          if (!cancelled) setState({ status: 'not_found' });
          return null;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ApiGuestHub>;
      })
      .then(data => {
        if (!data || cancelled) return;
        setState({ status: 'ready', data: mapGuestHub(data) });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: 'error',
            retry: () => setAttempt(a => a + 1),
          });
        }
      });

    return () => { cancelled = true; };
  }, [slug, attempt]);

  return state;
}
