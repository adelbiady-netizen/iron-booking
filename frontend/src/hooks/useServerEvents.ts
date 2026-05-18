import { useEffect, useRef, useState } from 'react';
import { BASE, getStoredAuth } from '../api';

type EventHandlers = Record<string, (data: unknown) => void>;
export type SseStatus = 'connected' | 'reconnecting' | 'disconnected';

// Backoff delays in ms: 1s, 2s, 4s, 8s, 16s, 30s (cap)
const BACKOFF = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
// After this many consecutive failures the status reads 'disconnected' rather
// than 'reconnecting' — signals the host that intervention may be needed.
const DISCONNECTED_THRESHOLD = BACKOFF.length;

/**
 * Connects to the SSE stream at /api/integrations/events.
 * Auth token passed as query param because native EventSource cannot
 * send custom headers.
 *
 * Reconnects automatically on error with exponential backoff.
 * Re-reads the stored auth token on each reconnect attempt so that a
 * token refreshed by a re-login in another tab is picked up.
 *
 * Handlers are read via a ref so callers never need to worry about stale
 * closures — pass a plain object literal each render.
 *
 * Returns live connection status so the UI can surface a reconnecting
 * indicator during network interruptions.
 */
export function useServerEvents(handlers: EventHandlers): SseStatus {
  const handlersRef = useRef<EventHandlers>(handlers);
  handlersRef.current = handlers;
  const [status, setStatus] = useState<SseStatus>('connected');

  useEffect(() => {
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let es: EventSource | null = null;
    let stopped = false;

    function connect() {
      if (stopped) return;

      const auth = getStoredAuth();
      if (!auth?.token) {
        console.warn('[useServerEvents] no auth token — aborting connect, will NOT retry');
        setStatus('disconnected');
        return;
      }

      const url = `${BASE}/integrations/events?token=${encodeURIComponent(auth.token)}`;
      es = new EventSource(url);

      es.onopen = () => {
        attempt = 0;
        setStatus('connected');
      };

      es.addEventListener('incoming_call', (e: MessageEvent) => {
        console.log('[CALL-DBG] SSE raw event received — data:', e.data);
        try {
          const data = JSON.parse(e.data) as unknown;
          handlersRef.current['incoming_call']?.(data);
        } catch { /* ignore malformed JSON */ }
      });

      es.addEventListener('floor_updated', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as unknown;
          handlersRef.current['floor_updated']?.(data);
        } catch { /* ignore malformed JSON */ }
      });

      es.onerror = (err) => {
        console.warn('[useServerEvents] SSE error — readyState:', es?.readyState, err);
        es?.close();
        es = null;
        if (stopped) return;
        attempt++;
        const delay = BACKOFF[Math.min(attempt - 1, BACKOFF.length - 1)];
        setStatus(attempt >= DISCONNECTED_THRESHOLD ? 'disconnected' : 'reconnecting');
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return status;
}
