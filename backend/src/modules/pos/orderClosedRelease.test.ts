/**
 * Unit test for handleOrderClosed source-independence (#2) — run with:
 *   npx ts-node --transpile-only src/modules/pos/orderClosedRelease.test.ts
 *
 * Asserts that a POS order close (order.closed / visit.table_released) frees and
 * auto-completes the bound reservation IDENTICALLY regardless of the reservation's
 * source (online / host / walk-in). Release is keyed on posVisitId ONLY — the
 * queries never filter on `source` — so every bound reservation is treated the same.
 *
 * A require hook swaps ../../lib/prisma for an in-memory fake BEFORE service.ts is
 * loaded, so the test runs without a database (and without DATABASE_URL).
 */

import assert from 'node:assert/strict';
import Module from 'node:module';

type Row = {
  id: string;
  restaurantId: string;
  posVisitId: string | null;
  status: string;
  source: string;
  posOrderActive: boolean;
  billRequested: boolean;
  billRequestedAt: Date | null;
  fired: boolean;
  firedAt: Date | null;
  completedAt: Date | null;
};

const RID = 'rest-1';

// Three reservations bound to the same POS order, differing ONLY by source, plus
// one bound to a different order (must stay untouched — scoping proof).
const rows: Row[] = [
  { id: 'online', restaurantId: RID, posVisitId: 'v1', status: 'SEATED', source: 'ONLINE',  posOrderActive: true, billRequested: true, billRequestedAt: new Date(), fired: true, firedAt: new Date(), completedAt: null },
  { id: 'host',   restaurantId: RID, posVisitId: 'v1', status: 'SEATED', source: 'PHONE',   posOrderActive: true, billRequested: true, billRequestedAt: new Date(), fired: true, firedAt: new Date(), completedAt: null },
  { id: 'walkin', restaurantId: RID, posVisitId: 'v1', status: 'SEATED', source: 'WALK_IN', posOrderActive: true, billRequested: true, billRequestedAt: new Date(), fired: true, firedAt: new Date(), completedAt: null },
  { id: 'other',  restaurantId: RID, posVisitId: 'v2', status: 'SEATED', source: 'ONLINE',  posOrderActive: true, billRequested: true, billRequestedAt: new Date(), fired: true, firedAt: new Date(), completedAt: null },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const whereCalls: any[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakePrisma: any = {
  reservation: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateMany: async ({ where, data }: any) => {
      whereCalls.push(where);
      let count = 0;
      for (const r of rows) {
        if (where.restaurantId && r.restaurantId !== where.restaurantId) continue;
        if (where.posVisitId && r.posVisitId !== where.posVisitId) continue;
        if (where.status && r.status !== where.status) continue;
        Object.assign(r, data);
        count++;
      }
      return { count };
    },
  },
};

// Intercept the lib/prisma import so the real PrismaClient is never constructed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const origLoad = (Module as any)._load;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Module as any)._load = function (request: string, ...rest: any[]) {
  if (/(^|[\\/])lib[\\/]prisma(\.ts)?$/.test(request) || request.endsWith('lib/prisma')) {
    return { prisma: fakePrisma };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return origLoad.call(this, request, ...rest);
};

// Load service AFTER the hook is installed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleOrderClosed } = require('./service') as typeof import('./service');

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ✓  ${name}`); passed++; })
    .catch((e: unknown) => { console.error(`  ✗  ${name}`); console.error(`     ${(e as Error).message}`); failed++; });
}

async function run(): Promise<void> {
  console.log('\nhandleOrderClosed — source-independent release (#2)');

  const occurredAt = '2026-09-16T20:00:00.000Z';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event: any = { event_id: 'e1', type: 'visit.table_released', visit_id: 'v1', occurred_at: occurredAt, payload: {} };

  await handleOrderClosed(RID, event);

  await test('online reservation is freed + completed', () => {
    const r = rows.find(x => x.id === 'online')!;
    assert.equal(r.posOrderActive, false);
    assert.equal(r.status, 'COMPLETED');
    assert.equal(r.billRequested, false);
    assert.equal(r.fired, false);
    assert.deepEqual(r.completedAt, new Date(occurredAt));
  });

  await test('host (PHONE) reservation is freed + completed — identically', () => {
    const r = rows.find(x => x.id === 'host')!;
    assert.equal(r.posOrderActive, false);
    assert.equal(r.status, 'COMPLETED');
    assert.equal(r.billRequested, false);
    assert.equal(r.fired, false);
  });

  await test('walk-in reservation is freed + completed — identically', () => {
    const r = rows.find(x => x.id === 'walkin')!;
    assert.equal(r.posOrderActive, false);
    assert.equal(r.status, 'COMPLETED');
    assert.equal(r.billRequested, false);
    assert.equal(r.fired, false);
  });

  await test('a reservation bound to a DIFFERENT order is untouched (scoping)', () => {
    const r = rows.find(x => x.id === 'other')!;
    assert.equal(r.posOrderActive, true);
    assert.equal(r.status, 'SEATED');
  });

  await test('release is keyed on posVisitId — never on source', () => {
    assert.ok(whereCalls.length >= 2, 'expected the clear + auto-complete updateMany calls');
    for (const w of whereCalls) {
      assert.equal(w.posVisitId, 'v1');
      assert.equal(w.restaurantId, RID);
      assert.ok(!('source' in w), 'where clause must not filter on source');
    }
    // The clear pass targets all bound rows; the complete pass narrows to SEATED.
    assert.ok(whereCalls.some(w => w.status === undefined), 'first pass clears regardless of status');
    assert.ok(whereCalls.some(w => w.status === 'SEATED'), 'second pass completes only SEATED');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void run();
