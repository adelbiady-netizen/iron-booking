// Table-ready message builder — pure text tests (no DB, no network).
// Run: npm run test:table-ready

import assert from 'assert';
import { buildTableReadyMessage } from './tableReady';

let passed = 0;
function P(label: string, fn: () => void) { fn(); passed++; console.log(`PASS | ${label}`); }

P('Hebrew message includes greeting with guest name, restaurant name, and update request', () => {
  const msg = buildTableReadyMessage({ guestName: 'דנה לוי', restaurantName: 'Najma' });
  assert.ok(msg.includes('שלום דנה לוי'));
  assert.ok(msg.includes('השולחן שלכם ב־Najma מוכן'));
  assert.ok(msg.includes('אם אינכם יכולים להגיע, אנא עדכנו אותנו'));
});

P('missing guest name → natural greeting without a name', () => {
  const msg = buildTableReadyMessage({ guestName: null, restaurantName: 'Najma' });
  assert.ok(msg.startsWith('שלום,'));
  assert.ok(!msg.includes('undefined') && !msg.includes('null'));
});

P('whitespace-only guest name treated as missing', () => {
  const msg = buildTableReadyMessage({ guestName: '   ', restaurantName: 'Najma' });
  assert.ok(msg.startsWith('שלום,'));
});

P('no promise that the table is held indefinitely', () => {
  const msg = buildTableReadyMessage({ guestName: 'דנה', restaurantName: 'Najma' });
  assert.ok(!msg.includes('נשמור') && !msg.includes('יישמר') && !msg.includes('ללא הגבלה'));
});

P('English variant renders correctly', () => {
  const msg = buildTableReadyMessage({ guestName: 'Dana', restaurantName: 'Najma', lang: 'en' });
  assert.ok(msg.includes('Hi Dana,'));
  assert.ok(msg.includes('Your table at Najma is ready'));
});

console.log(`\n${passed}/5 table-ready tests passed`);
process.exit(0);
