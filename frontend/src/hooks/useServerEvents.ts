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
    let rawAbort: AbortController | null = null;

    // ── Parallel raw fetch reader ─────────────────────────────────────────────
    // Reads the SSE stream as raw text to prove whether the browser actually
    // receives the incoming_call bytes, independent of EventSource event routing.
    async function startRawReader(url: string, abort: AbortController) {
      console.log('[sse:raw] Starting parallel fetch reader for raw bytes');
      try {
        const resp = await fetch(url, {
          signal: abort.signal,
          headers: { Accept: 'text/event-stream' },
        });
        console.log('[sse:raw] fetch connected — status:', resp.status, 'ok:', resp.ok);
        if (!resp.body) {
          console.warn('[sse:raw] No response body — cannot read raw stream');
          return;
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('[sse:raw] Stream ended (done=true)');
            break;
          }
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          // Log each complete SSE frame (delimited by \n\n)
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            if (frame.trim()) {
              console.log('[sse:raw] FRAME received:', JSON.stringify(frame));
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log('[sse:raw] Reader aborted (cleanup)');
        } else {
          console.warn('[sse:raw] fetch reader error:', err);
        }
      }
    }

    function connect() {
      if (stopped) return;

      const auth = getStoredAuth();
      if (!auth?.token) {
        console.warn('[useServerEvents] no auth token — aborting connect, will NOT retry');
        setStatus('disconnected');
        return;
      }

      const tokenPreview = auth.token.slice(0, 8) + '…';
      const url = `${BASE}/integrations/events?token=${encodeURIComponent(auth.token)}`;
      console.log(
        '[sse:connect] Attempting connection — attempt:', attempt,
        '| BASE:', BASE,
        '| token prefix:', tokenPreview,
        '| handlers:', Object.keys(handlersRef.current),
      );

      // Start parallel raw reader on every (re)connect
      rawAbort?.abort();
      rawAbort = new AbortController();
      startRawReader(url, rawAbort);

      es = new EventSource(url);
      console.log('[sse:connect] EventSource created — readyState:', es.readyState, '(0=CONNECTING)');

      es.onopen = () => {
        console.log('[sse:connect] onopen fired — readyState:', es?.readyState, '(1=OPEN) | attempt was:', attempt);
        attempt = 0;
        setStatus('connected');
      };

      es.onmessage = (e: MessageEvent) => {
        // Catches unnamed events (event: message or no event: line)
        console.log('[sse:raw] onmessage (unnamed):', JSON.stringify(e.data));
      };

      es.addEventListener('messageerror', (e) => {
        console.warn('[sse:raw] messageerror event:', e);
      });

      console.log('[sse:connect] Registering addEventListener for "incoming_call"');
      es.addEventListener('incoming_call', (e: MessageEvent) => {
        console.log('[sse:raw] incoming_call addEventListener fired — raw data:', JSON.stringify(e.data));
        try {
          const data = JSON.parse(e.data) as unknown;
          console.log('[call:sse] ⓪ SSE incoming_call received at hook layer — hasHandler:', !!handlersRef.current['incoming_call']);
          handlersRef.current['incoming_call']?.(data);
        } catch { /* ignore malformed JSON */ }
      });

      console.log('[sse:connect] Registering addEventListener for "floor_updated"');
      es.addEventListener('floor_updated', (e: MessageEvent) => {
        console.log('[sse:raw] floor_updated addEventListener fired');
        try {
          const data = JSON.parse(e.data) as unknown;
          handlersRef.current['floor_updated']?.(data);
        } catch { /* ignore malformed JSON */ }
      });

      console.log('[sse:connect] All listeners registered — readyState:', es.readyState);

      es.onerror = (err) => {
        console.warn(
          '[sse:connect] onerror — readyState:', es?.readyState,
          '(0=CONNECTING,1=OPEN,2=CLOSED) | attempt:', attempt, '| err:', err,
        );
        es?.close();
        es = null;
        rawAbort?.abort();
        rawAbort = null;
        if (stopped) return;
        attempt++;
        const delay = BACKOFF[Math.min(attempt - 1, BACKOFF.length - 1)];
        console.log('[sse:connect] Scheduling reconnect in', delay, 'ms (attempt', attempt, ')');
        setStatus(attempt >= DISCONNECTED_THRESHOLD ? 'disconnected' : 'reconnecting');
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      console.log('[sse:connect] Cleanup — stopping SSE and raw reader');
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
      rawAbort?.abort();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return status;
}
