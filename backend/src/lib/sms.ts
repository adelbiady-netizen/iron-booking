export interface SmsResult {
  success: boolean;
  to: string;
  body: string;
}

// ── Phone formatting ──────────────────────────────────────────────────────────
// Accepts: 05XXXXXXXX  |  +9725XXXXXXXX  |  9725XXXXXXXX
export function formatPhone(raw: string): string {
  const stripped = raw.replace(/[\s\-().]/g, '');

  if (stripped.startsWith('+')) {
    const digits = stripped.slice(1).replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) throw new Error(`Invalid phone number: "${raw}"`);
    return `+${digits}`;
  }

  const digits = stripped.replace(/\D/g, '');

  if (digits.startsWith('0') && digits.length === 10) return `+972${digits.slice(1)}`;
  if (digits.startsWith('972') && digits.length === 12) return `+${digits}`;

  throw new Error(
    `Cannot convert "${raw}" to international format. ` +
    `Expected Israeli 05XXXXXXXX, +972XXXXXXXXX, or 972XXXXXXXXX.`
  );
}

// ── Core WhatsApp dispatch ────────────────────────────────────────────────────
// Uses UltraMsg when env vars are set; falls back to console mock.
export async function sendWhatsApp(phone: string, body: string): Promise<SmsResult> {
  const to         = formatPhone(phone);
  const instanceId = process.env['ULTRAMSG_INSTANCE_ID'];
  const token      = process.env['ULTRAMSG_TOKEN'];

  if (instanceId && token) {
    let res: Response;
    try {
      res = await fetch(`https://api.ultramsg.com/${instanceId}/messages/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, to, body }),
      });
    } catch (err) {
      throw new Error(`WhatsApp request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      console.error(`[UltraMsg] HTTP ${res.status} — ${text}`);
      throw new Error(`WhatsApp delivery failed (HTTP ${res.status})`);
    }

    const json = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (json?.sent !== 'true' && json?.sent !== true) {
      console.error('[UltraMsg] Unexpected response:', JSON.stringify({ ...json, token: '[REDACTED]' }));
      throw new Error(`WhatsApp delivery failed: ${String(json?.message ?? 'unexpected provider response')}`);
    }

    console.log(`[UltraMsg] WhatsApp sent → ${to}`);
    return { success: true, to, body };
  }

  console.log(`[SMS mock] → ${to}\n${body}\n`);
  return { success: true, to, body };
}

// ── Confirmation message ──────────────────────────────────────────────────────

function fmtDateHe(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export async function sendConfirmationSms(
  phone: string,
  guestName: string,
  restaurantName: string,
  date: string,
  time: string,
  partySize: number,
  confirmUrl: string,
  lang: 'en' | 'he' = 'en'
): Promise<SmsResult> {
  const body = lang === 'he'
    ? `היי ${guestName},\n` +
      `נשמח לאשר את ההזמנה שלך ב־${restaurantName}\n\n` +
      `תאריך: ${fmtDateHe(date)}\n` +
      `שעה: ${time}\n` +
      `מספר אורחים: ${partySize}\n\n` +
      `לאישור הגעה או ביטול:\n${confirmUrl}`
    : `Hi ${guestName},\n` +
      `Please confirm your reservation at ${restaurantName}\n` +
      `Date: ${date}\n` +
      `Time: ${time}\n` +
      `Guests: ${partySize}\n\n` +
      `Confirm or cancel here:\n${confirmUrl}`;

  return sendWhatsApp(phone, body);
}

// ── Reminder message ──────────────────────────────────────────────────────────
export async function sendReminderSms(
  phone: string,
  guestName: string,
  restaurantName: string,
  time: string,
  confirmUrl: string
): Promise<SmsResult> {
  const body =
    `Hi ${guestName},\n` +
    `Just a quick reminder about your reservation at ${restaurantName} today at ${time}.\n` +
    `Please confirm your arrival here:\n${confirmUrl}`;

  return sendWhatsApp(phone, body);
}
