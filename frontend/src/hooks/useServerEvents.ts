import { useEffect, useRef } from 'react';
import { BASE, getStoredAuth } from '../api';

type EventHandlers = Record<string, (data: unknown) => void>;

/**
 * Connects to the SSE stream at /api/integrations/events.
 * Auth token passed as query param because native EventSource cannot
 * send custom headers.
 * Reconnects automatically on disconnect; cleans up on unmount.
 *
 * Handlers are read via a ref so callers never need to worry about stale
 * closures — just pass a plain object literal each render.
 */
export function useServerEvents(handlers: EventHandlers): void {
  const handlersRef = useRef<EventHandlers>(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const auth = getStoredAuth();

    if (!auth?.token) {
      console.warn('[useServerEvents] no auth token — aborting connect, will NOT retry');
      return;
    }

    const url = `${BASE}/integrations/events?token=${encodeURIComponent(auth.token)}`;
    const es = new EventSource(url);

    es.addEventListener('incoming_call', (e: MessageEvent) => {
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
      console.warn('[useServerEvents] SSE error — readyState:', es.readyState, err);
    };

    return () => {
      es.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
