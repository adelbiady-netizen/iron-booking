/**
 * One-time cleanup: find Guest CRM records where firstName === lastName (non-empty),
 * caused by the old splitName() bug that set lastName = firstName for single-word names.
 *
 * FLAGS
 *   (none)     Dry-run — print matching guests and reservation counts, no writes.
 *   --apply    Apply the fix: set lastName = '' where firstName === lastName.
 *
 * USAGE
 *   # Preview (safe, always default)
 *   npx ts-node --transpile-only scripts/fix-split-name-duplicates.ts
 *
 *   # Apply (explicit opt-in, requires non-production NODE_ENV or --apply)
 *   npx ts-node --transpile-only scripts/fix-split-name-duplicates.ts --apply
 *
 * SAFETY GUARDS
 *   - Defaults to dry-run; --apply is required for any writes.
 *   - Refuses to apply in NODE_ENV=production unless --apply is passed (belt-and-suspenders:
 *     the flag is still required, but the env check is an extra layer of protection).
 *   - Only touches rows where firstName === lastName AND both are non-empty strings.
 *   - Never touches firstName.
 *   - Logs every updated guest id before committing.
 *   - No schema changes.
 */

import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter } as any);

const APPLY   = process.argv.includes('--apply');
const DRY_RUN = !APPLY;

// ─── Safety guard ─────────────────────────────────────────────────────────────
if (APPLY && process.env.NODE_ENV === 'production') {
  console.error(
    '\n⛔  Safety block: NODE_ENV=production detected with --apply.\n' +
    '    Set NODE_ENV to something other than "production" to run writes,\n' +
    '    or verify you are not accidentally targeting the live database.\n'
  );
  process.exit(1);
}

async function main() {
  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`  fix-split-name-duplicates  [${DRY_RUN ? 'DRY-RUN' : 'APPLY'}]`);
  console.log('────────────────────────────────────────────────────────────\n');

  // ─── Find matching guests ──────────────────────────────────────────────────
  // We need firstName === lastName, both non-empty. Prisma doesn't support
  // column-column equality in a where clause directly, so fetch with a
  // non-empty lastName filter and filter in JS for the exact match.
  const candidates = await prisma.guest.findMany({
    where: {
      firstName: { not: '' },
      lastName:  { not: '' },
    },
    select: {
      id:           true,
      firstName:    true,
      lastName:     true,
      phone:        true,
      restaurantId: true,
      _count:       { select: { reservations: true } },
    },
    orderBy: [{ restaurantId: 'asc' }, { firstName: 'asc' }],
  });

  const matches = candidates.filter(g => g.firstName === g.lastName);

  console.log(`Guests with non-empty firstName AND lastName: ${candidates.length}`);
  console.log(`Guests where firstName === lastName (bug targets): ${matches.length}\n`);

  if (matches.length === 0) {
    console.log('✅  No affected guests found. Nothing to do.\n');
    await prisma.$disconnect();
    return;
  }

  // ─── Sample output ────────────────────────────────────────────────────────
  const SAMPLE_SIZE = 20;
  const sample = matches.slice(0, SAMPLE_SIZE);
  console.log(`Sample (up to ${SAMPLE_SIZE} rows):`);
  console.log('─'.repeat(100));
  console.log(
    'id'.padEnd(38) +
    'firstName'.padEnd(22) +
    'lastName'.padEnd(22) +
    'phone'.padEnd(18) +
    'restaurantId'.padEnd(38) +
    'reservations'
  );
  console.log('─'.repeat(100));
  for (const g of sample) {
    console.log(
      g.id.padEnd(38) +
      g.firstName.padEnd(22) +
      g.lastName.padEnd(22) +
      (g.phone ?? '—').padEnd(18) +
      g.restaurantId.padEnd(38) +
      String(g._count.reservations)
    );
  }
  if (matches.length > SAMPLE_SIZE) {
    console.log(`  … and ${matches.length - SAMPLE_SIZE} more (not shown)`);
  }
  console.log('─'.repeat(100));

  const totalReservations = matches.reduce((sum, g) => sum + g._count.reservations, 0);
  console.log(`\nTotal reservations referencing these guests: ${totalReservations}`);

  // ─── Dry-run exit ─────────────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log(
      '\n[DRY-RUN] No changes made.\n' +
      '  Re-run with --apply to set lastName = \'\' on all matching guests.\n'
    );
    await prisma.$disconnect();
    return;
  }

  // ─── Apply ────────────────────────────────────────────────────────────────
  console.log(`\n[APPLY] Updating ${matches.length} guest(s)…\n`);
  let updated = 0;
  for (const g of matches) {
    await prisma.guest.update({
      where: { id: g.id },
      data:  { lastName: '' },
    });
    console.log(`  ✓  ${g.id}  ${g.firstName} → lastName cleared`);
    updated++;
  }

  console.log(`\n✅  Done. ${updated} guest record(s) updated.\n`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('\n❌  Script failed:', err);
  prisma.$disconnect().catch(() => {});
  process.exit(1);
});
