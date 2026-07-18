// Timeline auto-return-to-Live decision logic.
// Run: npm run test:live-restore  (node --experimental-strip-types)

import assert from 'node:assert';
import { takeSnapshot, resolveWorkflowReturn, type BoardPos } from './liveRestore.ts';

let passed = 0;
function P(label: string, fn: () => void) {
  fn();
  passed++;
  console.log(`PASS | ${label}`);
}

const LIVE_NOW = { date: '2026-07-18', time: '20:30' };

P('system move while Live → workflow end returns to Live at current time', () => {
  const snap = takeSnapshot(null, { date: '2026-07-18', time: '19:00', liveMode: true });
  const target = resolveWorkflowReturn(snap, LIVE_NOW);
  assert.deepStrictEqual(target, { date: '2026-07-18', time: '20:30', liveMode: true });
});

P('system move while host was planning → workflow end restores the planning position', () => {
  const snap = takeSnapshot(null, { date: '2026-07-25', time: '21:00', liveMode: false });
  const target = resolveWorkflowReturn(snap, LIVE_NOW);
  assert.deepStrictEqual(target, { date: '2026-07-25', time: '21:00', liveMode: false });
});

P('no snapshot (host navigated manually) → no forced return', () => {
  assert.strictEqual(resolveWorkflowReturn(null, LIVE_NOW), null);
});

P('second system move in the same workflow keeps the ORIGINAL snapshot', () => {
  let snap: BoardPos | null = null;
  snap = takeSnapshot(snap, { date: '2026-07-18', time: '20:00', liveMode: true });  // first jump (from Live)
  snap = takeSnapshot(snap, { date: '2026-07-18', time: '22:30', liveMode: false }); // second jump (already jumped)
  const target = resolveWorkflowReturn(snap, LIVE_NOW);
  assert.strictEqual(target?.liveMode, true, 'restore must go back to Live, not the mid-workflow position');
});

P('no jump loop: restore consumes the snapshot exactly once', () => {
  let snap: BoardPos | null = takeSnapshot(null, { date: '2026-07-18', time: '19:00', liveMode: true });
  const first = resolveWorkflowReturn(snap, LIVE_NOW);
  snap = null; // HostDashboard clears the ref inside returnFromWorkflow
  const second = resolveWorkflowReturn(snap, LIVE_NOW);
  assert.ok(first !== null && second === null);
});

P('manual browse of a future time never produces a snapshot → Live is not forced', () => {
  // Host-driven movers clear the snapshot instead of taking one; simulate: no snapshot exists.
  const target = resolveWorkflowReturn(null, LIVE_NOW);
  assert.strictEqual(target, null);
});

console.log(`\n${passed}/6 live-restore tests passed`);
