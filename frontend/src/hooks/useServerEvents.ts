import { useEffect, useRef } from 'react';
import { BASE, getStoredAuth } from '../api';

type EventHandlers = Record<string, (data: unknown) => void>;

/**
 * Connects to the SSE stream at /api/integrations/events using fetch so we
 * can include the Authorization header (native EventSource cannot).
 * Reconnects automatically on disconnect; cleans up on unmount.
 *
 * Handlers are read via a ref so callers never need to worry about stale
 * closures — just pass a plain object literal each render.
 */
export function useServerEvents(handlers: EventHandlers): void {
  console.log('[useServerEvents] HOOK START');
  console.log('[useServerEvents] hook called');
  const handlersRef = useRef<EventHandlers>(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    console.log('[useServerEvents] effect mounted, BASE =', BASE);
    let active = true;
    let controller = new AbortController();

    async function connect() {
      console.log('[useServerEvents] checking auth');
      const auth = getStoredAuth();
      console.log('[useServerEvents] attempting connect — token present:', !!auth?.token, '| value prefix:', auth?.token?.slice(0, 12) ?? 'null');
      if (!auth?.token) {
        console.warn('[useServerEvents] no auth token — aborting connect, will NOT retry');
        return;
      }
      console.log('[useServerEvents] token found');

      controller = new AbortController();

      console.log('[useServerEvents] connecting to SSE:', `${BASE}/integrations/events`);
      try {
        const res = await fetch(`${BASE}/integrations/events`, {
          headers: { Authorization: `Bearer ${auth.token}` },
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          console.warn('[useServerEvents] SSE connect failed, status:', res.status);
          if (active) setTimeout(connect, 5_000);
          return;
        }
        console.log('[useServerEvents] SSE stream connected');

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer    = '';
        let eventType = 'message';

        while (active) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                console.log('[useServerEvents] SSE event received:', eventType, data);
                handlersRef.current[eventType]?.(data);
              } catch { /* ignore malformed JSON */ }
              eventType = 'message';
            }
            // lines starting with ':' are comments/pings — ignore
          }
        }
      } catch (err) {
        const name = (err as Error)?.name;
        if (name !== 'AbortError') console.warn('[useServerEvents] fetch error:', name, err);
      }

      if (active) {
        console.log('[useServerEvents] disconnected — reconnecting in 3 s');
        setTimeout(connect, 3_000);
      }
    }

    connect();

    return () => {
      console.log('[useServerEvents] effect cleanup — aborting');
      active = false;
      controller.abort();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
