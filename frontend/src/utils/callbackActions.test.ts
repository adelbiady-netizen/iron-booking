// Frontend P3 logic tests — Clear All / Undo overlay actions.
// Run: npm run test:callback-actions  (node --experimental-strip-types)
//
// Pure predicates + the dependency-injected runners, so the "authoritative
// refetch after every operation" and "conflict feedback" behaviours are verified
// without a browser. Convention matches callOverlay.test.ts.

import assert from 'node:assert';
import {
  shouldShowClearAll,
  clearAllConfirmText,
  isActionDisabled,
  hasUndoableItems,
  classifyUndoResult,
  isUndoConflict,
  runClearAll,
  runUndo,
} from './callbackActions.ts';
import type { CallbackUndoDescriptor } from '../types';

let passed = 0;
async function P(label: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`PASS | ${label}`);
}

const token = (): CallbackUndoDescriptor => ({
  operationId: 'op-1',
  completedAt: '2026-07-18T10:00:00.000Z',
  items: [
    { id: 'a', previousStatus: 'PENDING_CALLBACK' },
    { id: 'b', previousStatus: 'CALLBACK_IN_PROGRESS' },
  ],
});

async function main() {
  await P('Clear All is hidden at zero, shown when there is an unresolved set', () => {
    assert.strictEqual(shouldShowClearAll(0), false);
    assert.strictEqual(shouldShowClearAll(1), true);
    assert.strictEqual(shouldShowClearAll(6), true);
  });

  await P('confirmation contains the correct count', () => {
    const text = clearAllConfirmText(6, (n) => `Mark all ${n} callback items as handled?`);
    assert.strictEqual(text, 'Mark all 6 callback items as handled?');
    assert.ok(text.includes('6'));
    assert.ok(clearAllConfirmText(1, (n) => `כל ${n} הפריטים`).includes('1'));
  });

  await P('pending state disables duplicate action', () => {
    assert.strictEqual(isActionDisabled(true), true);
    assert.strictEqual(isActionDisabled(false), false);
  });

  await P('hasUndoableItems: true for a real token, false for empty/null', () => {
    assert.strictEqual(hasUndoableItems(token()), true);
    assert.strictEqual(hasUndoableItems(null), false);
    assert.strictEqual(hasUndoableItems({ operationId: 'x', completedAt: null, items: [{ id: 'a', previousStatus: 'PENDING_CALLBACK' }] }), false);
    assert.strictEqual(hasUndoableItems({ operationId: 'x', completedAt: '2026-07-18T10:00:00Z', items: [] }), false);
  });

  await P('Undo toast appears after a successful Clear All (undo token returned)', async () => {
    const res = await runClearAll({
      clearAll: async () => ({ count: 2, undo: token() }),
      refetch: () => {},
    });
    assert.strictEqual(res.count, 2);
    assert.notStrictEqual(res.undo, null);
    assert.strictEqual(res.undo?.items.length, 2);
  });

  await P('No Undo toast when Clear All changed nothing (count 0)', async () => {
    const res = await runClearAll({
      clearAll: async () => ({ count: 0, undo: { operationId: 'op', completedAt: null, items: [] } }),
      refetch: () => {},
    });
    assert.strictEqual(res.count, 0);
    assert.strictEqual(res.undo, null);
  });

  await P('classifyUndoResult maps restored / partial / conflict / noop', () => {
    assert.strictEqual(classifyUndoResult({ restored: ['a', 'b'], conflicted: [] }), 'restored');
    assert.strictEqual(classifyUndoResult({ restored: ['a'], conflicted: ['b'] }), 'partial');
    assert.strictEqual(classifyUndoResult({ restored: [], conflicted: ['b'] }), 'conflict');
    assert.strictEqual(classifyUndoResult({ restored: [], conflicted: [] }), 'noop');
  });

  await P('conflict feedback triggers for conflict and partial, not restored', () => {
    assert.strictEqual(isUndoConflict('conflict'), true);
    assert.strictEqual(isUndoConflict('partial'), true);
    assert.strictEqual(isUndoConflict('restored'), false);
    assert.strictEqual(isUndoConflict('noop'), false);
  });

  await P('conflict error is surfaced when Undo can no longer restore', async () => {
    const res = await runUndo(
      { undo: async () => ({ restored: [], conflicted: ['a'] }), refetch: () => {} },
      token(),
    );
    assert.strictEqual(res.outcome, 'conflict');
    assert.strictEqual(isUndoConflict(res.outcome), true);
  });

  await P('authoritative refetch occurs after a successful Clear All', async () => {
    let refetched = 0;
    await runClearAll({ clearAll: async () => ({ count: 1, undo: token() }), refetch: () => { refetched++; } });
    assert.strictEqual(refetched, 1);
  });

  await P('authoritative refetch occurs after a successful Undo', async () => {
    let refetched = 0;
    await runUndo(
      { undo: async () => ({ restored: ['a', 'b'], conflicted: [] }), refetch: () => { refetched++; } },
      token(),
    );
    assert.strictEqual(refetched, 1);
  });

  await P('authoritative refetch still occurs when the request fails', async () => {
    let refetched = 0;
    await assert.rejects(
      runClearAll({ clearAll: async () => { throw new Error('network'); }, refetch: () => { refetched++; } }),
    );
    assert.strictEqual(refetched, 1);
  });

  console.log(`\n${passed}/12 callback-actions tests passed`);
}

main().catch((err) => {
  console.error('FAIL |', err);
  process.exit(1);
});
