/**
 * Unit tests for flag.ts — run with:
 *   npx ts-node --transpile-only src/modules/pos/flag.test.ts
 *
 * No test framework or database required; all functions read process.env at
 * call-time and are otherwise pure.
 *
 * Covers the per-location allowlist that scopes the ATLAS integration to a
 * chosen set of locations even while the global master switch is on — so the
 * demo (and only the demo) can be enabled while every other location stays
 * inert by construction.
 */

import assert from 'node:assert/strict';
import {
  atlasSyncEnabled,
  locationAllowed,
  atlasSyncEnabledForLocation,
} from './flag';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${(e as Error).message}`);
    failed++;
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DEMO  = 'f0d59744-e974-46d8-a445-064906eb2417'; // the demo location (ATLAS location_id)
const OTHER = '11111111-2222-3333-4444-555555555555'; // any other location

// Restore env after each mutation so tests never leak into one another.
function withEnv(
  vars: { enabled?: string; allow?: string },
  fn: () => void,
): void {
  const prevEnabled = process.env.ATLAS_SYNC_ENABLED;
  const prevAllow   = process.env.ATLAS_SYNC_ALLOWED_LOCATIONS;
  try {
    if ('enabled' in vars) {
      if (vars.enabled === undefined) delete process.env.ATLAS_SYNC_ENABLED;
      else process.env.ATLAS_SYNC_ENABLED = vars.enabled;
    }
    if ('allow' in vars) {
      if (vars.allow === undefined) delete process.env.ATLAS_SYNC_ALLOWED_LOCATIONS;
      else process.env.ATLAS_SYNC_ALLOWED_LOCATIONS = vars.allow;
    }
    fn();
  } finally {
    if (prevEnabled === undefined) delete process.env.ATLAS_SYNC_ENABLED;
    else process.env.ATLAS_SYNC_ENABLED = prevEnabled;
    if (prevAllow === undefined) delete process.env.ATLAS_SYNC_ALLOWED_LOCATIONS;
    else process.env.ATLAS_SYNC_ALLOWED_LOCATIONS = prevAllow;
  }
}

// ─── atlasSyncEnabled (global master switch) ────────────────────────────────────

console.log('\natlasSyncEnabled');

test('true only when env is exactly "true"', () => {
  withEnv({ enabled: 'true' }, () => assert.equal(atlasSyncEnabled(), true));
  withEnv({ enabled: 'false' }, () => assert.equal(atlasSyncEnabled(), false));
  withEnv({ enabled: 'TRUE' }, () => assert.equal(atlasSyncEnabled(), false));
  withEnv({ enabled: undefined }, () => assert.equal(atlasSyncEnabled(), false));
});

// ─── locationAllowed (per-location allowlist) ───────────────────────────────────

console.log('\nlocationAllowed');

test('unset allowlist allows every location (back-compat, whole fleet)', () => {
  withEnv({ allow: undefined }, () => {
    assert.equal(locationAllowed(DEMO), true);
    assert.equal(locationAllowed(OTHER), true);
    assert.equal(locationAllowed(null), true);
  });
});

test('empty / whitespace-only allowlist is treated as unset (allows all)', () => {
  withEnv({ allow: '' }, () => assert.equal(locationAllowed(OTHER), true));
  withEnv({ allow: '   ' }, () => assert.equal(locationAllowed(OTHER), true));
  withEnv({ allow: ' , , ' }, () => assert.equal(locationAllowed(OTHER), true));
});

test('non-empty allowlist permits only listed locations', () => {
  withEnv({ allow: DEMO }, () => {
    assert.equal(locationAllowed(DEMO), true);
    assert.equal(locationAllowed(OTHER), false);
  });
});

test('a null/undefined location is never allowed while an allowlist is in force', () => {
  withEnv({ allow: DEMO }, () => {
    assert.equal(locationAllowed(null), false);
    assert.equal(locationAllowed(undefined), false);
  });
});

test('allowlist matching ignores surrounding whitespace and case', () => {
  withEnv({ allow: `  ${DEMO.toUpperCase()} , ${OTHER}  ` }, () => {
    assert.equal(locationAllowed(DEMO), true);   // stored upper, queried lower
    assert.equal(locationAllowed(OTHER), true);
  });
});

// ─── atlasSyncEnabledForLocation (combined gate) ────────────────────────────────

console.log('\natlasSyncEnabledForLocation');

test('global switch off blocks even an allowlisted location', () => {
  withEnv({ enabled: 'false', allow: DEMO }, () => {
    assert.equal(atlasSyncEnabledForLocation(DEMO), false);
  });
});

test('global on + location allowlisted → enabled', () => {
  withEnv({ enabled: 'true', allow: DEMO }, () => {
    assert.equal(atlasSyncEnabledForLocation(DEMO), true);
  });
});

test('global on + location NOT allowlisted → disabled (the demo-only guarantee)', () => {
  withEnv({ enabled: 'true', allow: DEMO }, () => {
    assert.equal(atlasSyncEnabledForLocation(OTHER), false);
    assert.equal(atlasSyncEnabledForLocation(null), false);
  });
});

test('global on + no allowlist → enabled for any location (whole fleet)', () => {
  withEnv({ enabled: 'true', allow: undefined }, () => {
    assert.equal(atlasSyncEnabledForLocation(OTHER), true);
  });
});

// ─── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
