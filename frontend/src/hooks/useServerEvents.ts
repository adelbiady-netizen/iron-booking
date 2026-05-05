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
  console.log('[useServerEvents] HOOK START');
  const handlersRef = useRef<EventHandlers>(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    console.log('[useServerEvents] effect mounted, BASE =', BASE);

    console.log('[useServerEvents] checking auth');
    const auth = getStoredAuth();
    console.log('[useServerEvents] attempting connect — token present:', !!auth?.token, '| value prefix:', auth?.token?.slice(0, 12) ?? 'null');

    if (!auth?.token) {
      console.warn('[useServerEvents] no auth token — aborting connect, will NOT retry');
      return;
    }
    console.log('[useServerEvents] token found');

    const url = `${BASE}/integrations/events?token=${encodeURIComponent(auth.token)}`;
    console.log('[useServerEvents] connecting to SSE:', url.replace(/token=[^&]+/, 'token=<redacted>'));

    const es = new EventSource(url);

    es.onopen = () => {
      console.log('[useServerEvents] SSE stream connected');
    };

    es.addEventListener('incoming_call', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as unknown;
        console.log('[useServerEvents] SSE event received: incoming_call', data);
        handlersRef.current['incoming_call']?.(data);
      } catch { /* ignore malformed JSON */ }
    });

    es.onerror = (err) => {
      console.warn('[useServerEvents] SSE error — readyState:', es.readyState, err);
    };

    return () => {
      console.log('[useServerEvents] effect cleanup — closing EventSource');
      es.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
