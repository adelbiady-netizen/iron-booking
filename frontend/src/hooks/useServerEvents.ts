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
  const handlersRef = useRef<EventHandlers>(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let active = true;
    let controller = new AbortController();

    async function connect() {
      const auth = getStoredAuth();
      if (!auth?.token) return;

      controller = new AbortController();

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
      } catch {
        // AbortError on cleanup, network error on disconnect — both are fine
      }

      if (active) setTimeout(connect, 3_000); // reconnect after brief pause
    }

    connect();

    return () => {
      active = false;
      controller.abort();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
