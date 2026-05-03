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

// ── Confirmation message templates ───────────────────────────────────────────

export interface ConfirmationMessagePayload {
  guestName:       string;
  restaurantName:  string;
  date:            string;   // ISO YYYY-MM-DD
  time:            string;   // HH:MM (24 h)
  partySize:       number;
  confirmationUrl: string;
}

function fmtDateHe(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function buildReservationConfirmationWhatsAppMessage(
  lang: 'en' | 'he',
  p: ConfirmationMessagePayload
): string {
  if (lang === 'he') {
    return (
      `היי ${p.guestName},\n\n` +
      `נשמח לאשר את ההזמנה שלך ב־${p.restaurantName}\n\n` +
      `תאריך: ${fmtDateHe(p.date)}\n` +
      `שעה: ${p.time}\n` +
      `מספר אורחים: ${p.partySize}\n\n` +
      `לאישור הגעה או ביטול:\n${p.confirmationUrl}`
    );
  }
  return (
    `Hi ${p.guestName},\n\n` +
    `Please confirm your reservation at ${p.restaurantName}\n\n` +
    `Date: ${p.date}\n` +
    `Time: ${p.time}\n` +
    `Guests: ${p.partySize}\n\n` +
    `Confirm or cancel here:\n${p.confirmationUrl}`
  );
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
  const message = buildReservationConfirmationWhatsAppMessage(lang, {
    guestName,
    restaurantName,
    date,
    time,
    partySize,
    confirmationUrl: confirmUrl,
  });
  console.log('[REAL WHATSAPP SEND PATH]', {
    file: __filename,
    lang,
    confirmationUrl: confirmUrl,
    messagePreview: message.slice(0, 160),
  });
  return sendWhatsApp(phone, message);
}

// ── Waitlist acknowledgment templates ────────────────────────────────────────

export interface WaitlistMessagePayload {
  guestName:     string;
  restaurantName: string;
  date:          string;   // ISO YYYY-MM-DD
  partySize:     number;
  preferredTime: string;   // HH:MM (24 h)
  flexibleTime?: boolean;
}

export function buildWaitlistWhatsAppMessage(
  lang: 'en' | 'he',
  p: WaitlistMessagePayload
): string {
  const flexibleHe = p.flexibleTime ? '\nגמישות: ±שעה' : '';
  const flexibleEn = p.flexibleTime ? '\nFlexible: ±1 hour' : '';

  if (lang === 'he') {
    return (
      `היי ${p.guestName},\n\n` +
      `נרשמת לרשימת ההמתנה ב־${p.restaurantName}.\n\n` +
      `תאריך: ${fmtDateHe(p.date)}\n` +
      `מספר אורחים: ${p.partySize}\n` +
      `שעה מבוקשת: ${p.preferredTime}${flexibleHe}\n\n` +
      `ניצור איתך קשר אם יתפנה שולחן. תודה על הסבלנות.\n\n` +
      `— ${p.restaurantName}`
    );
  }
  return (
    `Hi ${p.guestName},\n\n` +
    `You're on the waitlist at ${p.restaurantName}.\n\n` +
    `Date: ${p.date}\n` +
    `Party: ${p.partySize} ${p.partySize === 1 ? 'guest' : 'guests'}\n` +
    `Preferred time: ${p.preferredTime}${flexibleEn}\n\n` +
    `We'll reach out if a table becomes available. Thank you for your patience.\n\n` +
    `— ${p.restaurantName}`
  );
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
