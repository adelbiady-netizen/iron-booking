// Najma seating-duration wording — proves the two-hour rule is what guests read.
// Pure text tests over the real production template composition path
// (default builders + composeSms with Najma's actual DB addon wording).
// Run: npm run test:najma-wording

import assert from 'assert';
import { formatDurationHe, formatDurationByLang } from './duration';
import { buildReservationReceivedText, buildConfirmationRequestSmsText, buildReminderSmsText } from './smsDefaults';
import { composeSms } from './smsTemplates';

let passed = 0;
function P(label: string, fn: () => void) { fn(); passed++; console.log(`PASS | ${label}`); }

// Najma production configuration (slug "njma"): TurnTimeRule 1–20 → 120 min,
// settings.defaultTurnMinutes = 120, addon texts below are the live DB values.
const NAJMA_DURATION = 120;
const NAJMA_SETTINGS = {
  smsTemplates: {
    RESERVATION_RECEIVED: {
      main: null,
      addon: 'שימו לב, הישיבה על הבר ושולחן האבירים תתאפשר לזוגות בלבד. השולחן ישמר לרבע שעה ממועד ההזמנה, והשולחן יעמוד לרשותכם למשך שעתיים. אנו לא מתחייבים על שולחן או אזור ספציפי, אנא עדכנו אם יש שינויים.',
    },
    CONFIRMATION_REQUEST: {
      main: null,
      addon: 'השולחן יעמוד לרשותכם למשך שעתיים. אנו לא מתחייבים על שולחן או אזור ספציפי, אנא עדכנו אם יש שינויים.',
    },
    REMINDER: {
      main: null,
      addon: 'השולחן יעמוד לרשותכם למשך שעתיים. אנו לא מתחייבים על שולחן או אזור ספציפי, אנא עדכנו אם יש שינויים.',
    },
  },
} as Record<string, unknown>;

P('duration formatter: 120 → כשעתיים, 90 → כשעה וחצי (the two phrases in play)', () => {
  assert.strictEqual(formatDurationHe(120), 'כשעתיים');
  assert.strictEqual(formatDurationHe(90), 'כשעה וחצי');
});

P('dynamic interpolation for Najma (120) produces the two-hour phrase', () => {
  assert.strictEqual(formatDurationByLang(NAJMA_DURATION, 'he'), 'כשעתיים');
});

function composeNajma(type: 'RESERVATION_RECEIVED' | 'CONFIRMATION_REQUEST' | 'REMINDER', defaultText: string): string {
  return composeSms(type, defaultText, {
    guestName: 'דנה', restaurantName: 'Najma', date: '2026-07-20', time: '20:00', partySize: 2,
    reservationDuration: formatDurationByLang(NAJMA_DURATION, 'he'),
  }, NAJMA_SETTINGS);
}

P('RESERVATION_RECEIVED full message (main + addon): only two-hour wording, no 1.5h', () => {
  const main = buildReservationReceivedText({
    guestName: 'דנה', restaurantName: 'Najma', date: '2026-07-20', time: '20:00',
    partySize: 2, lang: 'he', duration: NAJMA_DURATION,
  });
  const full = composeNajma('RESERVATION_RECEIVED', main);
  assert.ok(full.includes('כשעתיים'), 'main duration line must say כשעתיים');
  assert.ok(full.includes('למשך שעתיים'), 'addon policy line says שעתיים');
  assert.ok(!full.includes('שעה וחצי'), 'no one-and-a-half-hour wording anywhere');
});

P('CONFIRMATION_REQUEST full message: only two-hour wording', () => {
  const main = buildConfirmationRequestSmsText(
    { guestName: 'דנה', date: '2026-07-20', time: '20:00', partySize: 2, guestLang: 'he', duration: NAJMA_DURATION },
    'Najma', 'https://x/confirm',
  );
  const full = composeNajma('CONFIRMATION_REQUEST', main);
  assert.ok(full.includes('כשעתיים') && !full.includes('שעה וחצי'));
});

P('REMINDER full message: only two-hour wording', () => {
  const main = buildReminderSmsText(
    { guestName: 'דנה', time: '20:00', guestLang: 'he', duration: NAJMA_DURATION },
    'Najma', 'https://x/confirm',
  );
  const full = composeNajma('REMINDER', main);
  assert.ok(full.includes('כשעתיים') && !full.includes('שעה וחצי'));
});

P('REGRESSION — the old bug: a 90-minute reservation + Najma addon contradicted itself', () => {
  const main = buildReservationReceivedText({
    guestName: 'דנה', restaurantName: 'Najma', date: '2026-07-20', time: '20:00',
    partySize: 2, lang: 'he', duration: 90, // pre-fix stored duration for parties ≤2
  });
  const full = composeSms('RESERVATION_RECEIVED', main, {
    guestName: 'דנה', restaurantName: 'Najma', reservationDuration: formatDurationByLang(90, 'he'),
  }, NAJMA_SETTINGS);
  // This asserts the bug MECHANISM (1.5h at the start, 2h later in the same message)
  // so it can never silently return: if duration ever resolves to 90 again for
  // Najma, the composed message would contradict itself exactly like this.
  assert.ok(full.includes('כשעה וחצי') && full.includes('למשך שעתיים'),
    'bug mechanism no longer reproducible — update this regression test');
  assert.ok(full.indexOf('כשעה וחצי') < full.indexOf('למשך שעתיים'));
});

P('other restaurants are unaffected: no addon → default text only, duration follows their own value', () => {
  const main = buildReservationReceivedText({
    guestName: 'Guest', restaurantName: 'Eataliano', date: '2026-07-20', time: '20:00',
    partySize: 2, lang: 'he', duration: 90,
  });
  const full = composeSms('RESERVATION_RECEIVED', main, { guestName: 'Guest', restaurantName: 'Eataliano' }, {});
  assert.ok(full.includes('כשעה וחצי'), 'other restaurants keep their own 90-min wording');
  assert.ok(!full.includes('למשך שעתיים'), 'Najma addon must not leak to other restaurants');
});

console.log(`\n${passed}/7 Najma wording tests passed`);
process.exit(0);
