// Fire-and-forget hostess telemetry. Never throws, never blocks UI.
// Backend stores events in host_events table for analysis.

const SESSION_KEY = 'ib_session_id';

function getSessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function getToken(): string | null {
  try {
    const raw = localStorage.getItem('iron_auth') ?? localStorage.getItem('iron_hq_auth');
    if (!raw) return null;
    return (JSON.parse(raw) as { token: string }).token;
  } catch {
    return null;
  }
}

const TELEMETRY_URL = 'https://iron-booking.onrender.com/api/telemetry/events';

export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  const token = getToken();
  if (!token) return;

  fetch(TELEMETRY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ event, properties, sessionId: getSessionId() }),
    keepalive: true,
  }).catch(() => {
    // Silently swallow — telemetry must never surface errors
  });
}
