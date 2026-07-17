// מזדמנים terminology — feature labels renamed, literal "waiting" grammar kept.
// Run: npm run test:terminology  (node --experimental-strip-types)

import assert from 'node:assert';
import { THe } from './strings-he.ts';

let passed = 0;
function P(label: string, fn: () => void) { fn(); passed++; console.log(`PASS | ${label}`); }

P('main tab label is מזדמנים', () => {
  assert.strictEqual(THe.reservationPanel.tabWaitlist, 'מזדמנים');
});

P('primary feature labels use מזדמנים and not ממתינים', () => {
  const featureLabels = [
    THe.waitlistPanel.addToWaitlistButton,
    THe.waitlistPanel.emptyTitle,
    THe.waitlistPanel.footerEmpty,
    THe.waitlistPanel.footerCount(3),
    THe.waitlistPanel.seatButton,
    THe.waitlistPanel.addLink,
    THe.floorBoard.ctxGuestWaitlist,
    THe.tableCard.waitlistWaiting(5),
    THe.hostDashboard.toastWLRemoved,
  ];
  for (const label of featureLabels) {
    assert.ok(label.includes('מזדמ'), `expected מזדמנים in: ${label}`);
  }
});

P('no feature label still says ממתינים / רשימת המתנה', () => {
  const featureLabels = [
    THe.reservationPanel.tabWaitlist,
    THe.waitlistPanel.addToWaitlistButton,
    THe.waitlistPanel.emptyTitle,
    THe.waitlistPanel.footerEmpty,
    THe.waitlistPanel.footerCount(3),
    THe.floorBoard.ctxGuestWaitlist,
    THe.hostDashboard.toastWLRemoved,
  ];
  for (const label of featureLabels) {
    assert.ok(!label.includes('ממתינים') && !label.includes('רשימת המתנה'), `stale term in: ${label}`);
  }
});

P('literal "currently waiting" phrasings are intentionally preserved', () => {
  // These mean "waiting N minutes" / "waiting at the entrance" — grammatical, not the feature name.
  assert.ok(THe.waitlistPanel.waitingMin(12).includes('ממתין'));
  assert.ok(THe.waitlistPanel.mWaiting(12).includes('המתנה'));
  assert.ok(THe.tableTimeline.mWait(10).includes('המתנה'));
  assert.ok(THe.guestDrawer.guestArrived.includes('ממתינים'));
});

P('unrelated domains keep their own wording (reservation PENDING status)', () => {
  assert.strictEqual(THe.reservationStatus.PENDING, 'ממתין');
});

console.log(`\n${passed}/5 terminology tests passed`);
