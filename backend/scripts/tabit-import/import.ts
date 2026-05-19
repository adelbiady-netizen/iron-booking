#!/usr/bin/env ts-node
/**
 * Tabit CRM Import
 *
 * Dry-run (default — no DB writes):
 *   DATABASE_URL=... npx ts-node --transpile-only scripts/tabit-import/import.ts \
 *     --file "path/to/export.xlsx" --restaurant <slug>
 *
 * Live import (writes to DB):
 *   DATABASE_URL=... npx ts-node --transpile-only scripts/tabit-import/import.ts \
 *     --file "path/to/export.xlsx" --restaurant <slug> --execute
 *
 * Safety guarantees:
 *   - Dry-run by default. --execute is required to touch the database.
 *   - Mobile-only: only /^05\d{8}$/ Israeli mobile numbers accepted.
 *   - Existing guests are preserved (skip by phone, then by email).
 *   - No marketing consent is set.
 *   - No messages are sent.
 *   - Source tag written: tabit_import_deli_italiano_2026
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import dotenv    from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg }     from '@prisma/adapter-pg';

dotenv.config();

// ── Constants ─────────────────────────────────────────────────────────────────

const COL_PHONE     = 'טלפון';
const COL_NAME      = 'שם';
const COL_EMAIL     = 'מייל';
const IMPORT_SOURCE = 'tabit_import_deli_italiano_2026';
const BATCH_SIZE    = 250;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedRow {
  lineNumber: number;
  firstName:  string;
  lastName:   string;
  phone:      string;        // normalized 05XXXXXXXX
  email:      string | null; // null = absent or invalid
}

// ── Phone normalization ────────────────────────────────────────────────────────
// Returns the normalized 05XXXXXXXX string, or null if the number is not a
// valid Israeli mobile. Landlines (04x, 02x, 03x, etc.) return null.
// This is the single source of truth for both import rows AND existing DB values.

function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-()+]/g, '').trim();
  if (!cleaned) return null;

  const withPlus = raw.replace(/[\s\-()‎‏]/g, '').trim();

  // +972XXXXXXXXX → 05XXXXXXXX
  if (withPlus.startsWith('+972')) {
    const local = '0' + withPlus.slice(4).replace(/\D/g, '');
    return /^05\d{8}$/.test(local) ? local : null;
  }

  // 972XXXXXXXXX (no +)
  if (/^972\d{9}$/.test(cleaned)) {
    const local = '0' + cleaned.slice(3);
    return /^05\d{8}$/.test(local) ? local : null;
  }

  // Already local: 05XXXXXXXX (10 digits)
  if (/^05\d{8}$/.test(cleaned)) return cleaned;

  // 5XXXXXXXX (9 digits, missing leading 0)
  if (/^5\d{8}$/.test(cleaned)) {
    const local = '0' + cleaned;
    return /^05\d{8}$/.test(local) ? local : null;
  }

  return null;
}

// ── Email normalization ────────────────────────────────────────────────────────

function normalizeEmail(raw: string): string | null {
  const clean = raw.trim().toLowerCase();
  if (!clean) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean) ? clean : null;
}

// ── Name splitting ─────────────────────────────────────────────────────────────
// Tabit exports one "שם" field. First whitespace-separated token = firstName,
// remainder = lastName. Single-token names: lastName = '' (allowed by schema).

function splitName(raw: string): { firstName: string; lastName: string } {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return { firstName: trimmed, lastName: '' };
  return {
    firstName: trimmed.slice(0, spaceIdx),
    lastName:  trimmed.slice(spaceIdx + 1),
  };
}

// ── XLSX parser ────────────────────────────────────────────────────────────────

interface RawRow {
  lineNumber: number;
  rawPhone:   string;
  rawName:    string;
  rawEmail:   string;
}

function loadXLSX(filePath: string): RawRow[] {
  const workbook  = XLSX.readFile(filePath, { type: 'file', codepage: 65001 });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('XLSX file has no worksheets.');

  const sheet    = workbook.Sheets[sheetName];
  const jsonRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
  }) as unknown[][];

  if (jsonRows.length < 2) throw new Error('XLSX sheet has fewer than 2 rows.');

  const headers  = (jsonRows[0] as unknown[]).map(h => String(h ?? '').trim());
  const phoneIdx = headers.findIndex(h => h === COL_PHONE);
  const nameIdx  = headers.findIndex(h => h === COL_NAME);
  const emailIdx = headers.findIndex(h => h === COL_EMAIL);

  if (phoneIdx === -1) throw new Error(`Column "${COL_PHONE}" not found. Found: ${headers.join(' | ')}`);
  if (nameIdx  === -1) throw new Error(`Column "${COL_NAME}" not found. Found: ${headers.join(' | ')}`);

  const rows: RawRow[] = [];
  for (let i = 1; i < jsonRows.length; i++) {
    const fields   = jsonRows[i] as unknown[];
    const rawPhone = String(fields[phoneIdx] ?? '').trim();
    const rawName  = String(fields[nameIdx]  ?? '').trim();
    const rawEmail = emailIdx !== -1 ? String(fields[emailIdx] ?? '').trim() : '';
    if (!rawPhone && !rawName && !rawEmail) continue; // completely blank row
    rows.push({ lineNumber: i + 1, rawPhone, rawName, rawEmail });
  }

  return rows;
}

// ── CLI arg parsing ────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let filePath:       string | undefined;
  let restaurantSlug: string | undefined;
  let execute = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file'       && args[i + 1]) { filePath       = args[++i]; continue; }
    if (args[i] === '--restaurant' && args[i + 1]) { restaurantSlug = args[++i]; continue; }
    if (args[i] === '--execute')                   { execute = true; }
  }

  return { filePath, restaurantSlug, execute };
}

function pct(n: number, total: number): string {
  if (total === 0) return '0';
  return Math.round((n / total) * 100).toString();
}

function hr(char = '─', width = 62): string {
  return char.repeat(width);
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── DB host safety check ───────────────────────────────────────────────────────
// Reads only the hostname from DATABASE_URL. Never prints credentials.

function assertNotLocalhost(url: string, step: string): void {
  try {
    const { hostname } = new URL(url);
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      console.error(`\n  ABORT: ${step} — DATABASE_URL points to localhost.`);
      console.error('  Set DATABASE_URL to the production connection string and retry.\n');
      process.exit(1);
    }
    console.log(`  DB host  : ${hostname}  ✓ (not localhost)`);
  } catch {
    console.error('  ABORT: DATABASE_URL is not a valid URL.');
    process.exit(1);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const { filePath, restaurantSlug, execute } = parseArgs();

  if (!filePath || !restaurantSlug) {
    console.error([
      '',
      'Usage:',
      '  DATABASE_URL=... npx ts-node --transpile-only scripts/tabit-import/import.ts \\',
      '    --file "path/to/export.xlsx" \\',
      '    --restaurant <slug> \\',
      '    [--execute]',
      '',
      '  Omit --execute to preview without writing (dry-run).',
      '',
    ].join('\n'));
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  // ── Pre-flight: verify DB host ─────────────────────────────────────────────
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is not set.');
    process.exit(1);
  }
  assertNotLocalhost(connectionString, 'pre-flight');

  const mode = execute ? '⚠  LIVE IMPORT — writing to database' : 'DRY RUN — no database writes';
  console.log(`\n${hr('═')}`);
  console.log(`  Tabit CRM Import`);
  console.log(`  Mode       : ${mode}`);
  console.log(`  Source tag : ${IMPORT_SOURCE}`);
  console.log(`  File       : ${path.basename(filePath)}`);
  console.log(`  Restaurant : ${restaurantSlug}`);
  console.log(`${hr('═')}\n`);

  // ── Step 1: Load and validate all rows ────────────────────────────────────
  console.log('Step 1: Loading file...');
  const rawRows = loadXLSX(filePath);
  console.log(`  ${rawRows.length} total data rows.\n`);

  const validRows: ParsedRow[] = [];
  let skippedInvalid = 0;

  for (const row of rawRows) {
    const phone = normalizePhone(row.rawPhone);
    if (!phone)              { skippedInvalid++; continue; }
    if (!row.rawName.trim()) { skippedInvalid++; continue; }

    const { firstName, lastName } = splitName(row.rawName);
    const email = normalizeEmail(row.rawEmail);
    validRows.push({ lineNumber: row.lineNumber, firstName, lastName, phone, email });
  }

  console.log(`  ${validRows.length} valid mobile rows`);
  console.log(`  ${skippedInvalid} skipped (landline / foreign / garbage / no name)\n`);

  // ── Step 2: Deduplicate within the file ───────────────────────────────────
  console.log('Step 2: Deduplicating within file...');

  const seenPhonesInFile = new Set<string>();
  const seenEmailsInFile = new Set<string>();
  const deduped: ParsedRow[] = [];
  let skippedFileDupe = 0;

  for (const row of validRows) {
    if (seenPhonesInFile.has(row.phone)) { skippedFileDupe++; continue; }
    if (row.email && seenEmailsInFile.has(row.email)) { skippedFileDupe++; continue; }
    seenPhonesInFile.add(row.phone);
    if (row.email) seenEmailsInFile.add(row.email);
    deduped.push(row);
  }

  console.log(`  ${deduped.length} unique rows after removing ${skippedFileDupe} within-file duplicates.\n`);

  // ── Step 3: Connect to database ───────────────────────────────────────────
  console.log('Step 3: Connecting to database...');
  assertNotLocalhost(connectionString, 'Step 3');

  const adapter = new PrismaPg({ connectionString });
  const prisma  = new PrismaClient({ adapter, log: ['error'] });

  try {
    // ── Step 4: Verify restaurant ────────────────────────────────────────
    console.log('\nStep 4: Verifying restaurant...');
    if (restaurantSlug !== 'italiano-dalla-costa') {
      console.error(`  ABORT: slug "${restaurantSlug}" is not the expected target (italiano-dalla-costa).`);
      process.exit(1);
    }

    const restaurant = await prisma.restaurant.findUnique({
      where:  { slug: restaurantSlug },
      select: { id: true, name: true, slug: true },
    });

    if (!restaurant) {
      console.error(`\n  ERROR: Restaurant slug "${restaurantSlug}" not found.`);
      const allRestaurants = await prisma.restaurant.findMany({
        where:   { isSystem: false },
        select:  { slug: true, name: true },
        orderBy: { name: 'asc' },
      });
      console.error('\n  Available restaurants:');
      for (const r of allRestaurants) {
        console.error(`    ${r.slug.padEnd(35)} "${r.name}"`);
      }
      console.error();
      process.exit(1);
    }

    console.log(`  Slug     : ${restaurant.slug}`);
    console.log(`  Name     : ${restaurant.name}`);
    console.log(`  ID       : ${restaurant.id}\n`);

    // ── Step 5: Load existing guests for dedup ────────────────────────────
    console.log('Step 5: Loading existing guests for dedup check...');
    const existingGuests = await prisma.guest.findMany({
      where:  { restaurantId: restaurant.id },
      select: { phone: true, email: true },
    });

    const existingPhoneSet = new Set<string>();
    const existingEmailSet = new Set<string>();

    for (const g of existingGuests) {
      if (g.phone) {
        const norm = normalizePhone(g.phone);
        if (norm) existingPhoneSet.add(norm);
      }
      if (g.email) existingEmailSet.add(g.email.toLowerCase().trim());
    }

    console.log(`  ${existingGuests.length} existing guests  (${existingPhoneSet.size} unique phones, ${existingEmailSet.size} unique emails)\n`);

    // ── Step 6: Compute import plan ───────────────────────────────────────
    console.log('Step 6: Computing import plan...');

    const toCreate: ParsedRow[] = [];
    let skippedExistingPhone = 0;
    let skippedExistingEmail = 0;

    for (const row of deduped) {
      if (existingPhoneSet.has(row.phone)) { skippedExistingPhone++; continue; }
      if (row.email && existingEmailSet.has(row.email)) { skippedExistingEmail++; continue; }
      toCreate.push(row);
    }

    const withEmail = toCreate.filter(r => r.email !== null).length;

    console.log();
    console.log(hr());
    console.log('  IMPORT PLAN');
    console.log(hr());
    console.log(`  Will create              : ${toCreate.length}`);
    console.log(`    of which, with email   : ${withEmail} (${pct(withEmail, toCreate.length)}%)`);
    console.log(`  Skip – phone in DB       : ${skippedExistingPhone}`);
    console.log(`  Skip – email in DB       : ${skippedExistingEmail}`);
    console.log(`  Skip – within-file dup   : ${skippedFileDupe}`);
    console.log(`  Skip – invalid/landline  : ${skippedInvalid}`);
    console.log(`  Total rows in file       : ${rawRows.length}`);
    console.log(hr());
    console.log();

    if (toCreate.length > 0) {
      console.log('  SAMPLE (first 5 to be created):');
      for (const row of toCreate.slice(0, 5)) {
        const nameStr  = `${row.firstName} ${row.lastName}`.trim();
        const emailStr = row.email ? ` | ${row.email}` : '';
        console.log(`    line ${String(row.lineNumber).padStart(5)}: "${nameStr}" | ${row.phone}${emailStr}`);
      }
      console.log();
    }

    // ── Dry-run stops here ─────────────────────────────────────────────────
    if (!execute) {
      console.log('DRY RUN COMPLETE — no writes performed.');
      console.log(`Add --execute to import ${toCreate.length} guests.\n`);
      return;
    }

    // ── Step 7: Execute batched creates ───────────────────────────────────
    if (toCreate.length === 0) {
      console.log('Nothing to create — all records already exist in DB.\n');
      return;
    }

    // Re-verify host immediately before first write
    assertNotLocalhost(connectionString, 'Step 7 pre-write');

    const totalBatches   = Math.ceil(toCreate.length / BATCH_SIZE);
    const importedAt     = new Date().toISOString().slice(0, 10);
    const internalNote   = `Imported from Tabit CRM export. Source: ${IMPORT_SOURCE}. Date: ${importedAt}.`;

    interface ErrorRow { lineNumber: number; phone: string; name: string; error: string; }
    const errorRows: ErrorRow[] = [];
    let totalCreated    = 0;
    let totalDbSkipped  = 0; // skipped by DB unique constraint (safety net)
    const startMs       = Date.now();

    console.log(`EXECUTING: ${toCreate.length} guests across ${totalBatches} batches of ${BATCH_SIZE}...\n`);

    for (let b = 0; b < totalBatches; b++) {
      const batch = toCreate.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);

      // Build insert data — explicit field list, no spreading unknown fields
      const data = batch.map(row => ({
        restaurantId:  restaurant.id,
        firstName:     row.firstName,
        lastName:      row.lastName,
        phone:         row.phone,
        email:         row.email ?? null,
        tags:          [IMPORT_SOURCE],
        internalNotes: internalNote,
        // Schema defaults (not set — listed here for audit clarity):
        //   isVip: false, isBlacklisted: false
        //   allergies: [], preferences: {}
        //   visitCount: 0, noShowCount: 0, cancelCount: 0
      }));

      try {
        // skipDuplicates handles (restaurantId, email) constraint as a safety net.
        // Primary phone+email dedup was already applied in Step 6.
        const result     = await prisma.guest.createMany({ data, skipDuplicates: true });
        const dbSkipped  = batch.length - result.count;
        totalCreated    += result.count;
        totalDbSkipped  += dbSkipped;

        const elapsed   = fmtMs(Date.now() - startMs);
        const label     = `Batch ${String(b + 1).padStart(3)}/${totalBatches}`;
        const skipNote  = dbSkipped > 0 ? `  [${dbSkipped} skipped by DB]` : '';
        console.log(`  ${label}  +${result.count} created  (${elapsed} elapsed)${skipNote}`);

      } catch (err) {
        // Batch-level error: log and collect, continue with next batch
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Batch ${b + 1}/${totalBatches}  ERROR: ${msg}`);
        for (const row of batch) {
          errorRows.push({
            lineNumber: row.lineNumber,
            phone:      row.phone,
            name:       `${row.firstName} ${row.lastName}`.trim(),
            error:      msg,
          });
        }
      }
    }

    const durationMs = Date.now() - startMs;

    // ── Step 8: Verify final guest count ──────────────────────────────────
    console.log('\nStep 8: Verifying final guest count...');
    const finalCount = await prisma.guest.count({
      where: { restaurantId: restaurant.id },
    });
    const finalWithEmail = await prisma.guest.count({
      where: { restaurantId: restaurant.id, email: { not: null } },
    });
    const taggedCount = await prisma.guest.count({
      where: { restaurantId: restaurant.id, tags: { has: IMPORT_SOURCE } },
    });

    // ── Write error report ─────────────────────────────────────────────────
    let errorReportPath: string | null = null;
    if (errorRows.length > 0) {
      errorReportPath = filePath.replace(/\.(csv|xlsx?)$/i, '') + '.import-errors.json';
      fs.writeFileSync(errorReportPath, JSON.stringify({ generatedAt: new Date().toISOString(), errors: errorRows }, null, 2), 'utf8');
    }

    // ── Final summary ──────────────────────────────────────────────────────
    console.log();
    console.log(hr('═'));
    console.log('  IMPORT COMPLETE');
    console.log(hr('═'));
    console.log(`  Created                  : ${totalCreated}`);
    console.log(`  Failed (batch errors)    : ${errorRows.length}`);
    console.log(`  Skipped by DB constraint : ${totalDbSkipped}`);
    console.log(`  Skip – phone in DB       : ${skippedExistingPhone}`);
    console.log(`  Skip – email in DB       : ${skippedExistingEmail}`);
    console.log(`  Skip – within-file dup   : ${skippedFileDupe}`);
    console.log(`  Skip – invalid/landline  : ${skippedInvalid}`);
    console.log(`  Total rows in file       : ${rawRows.length}`);
    console.log(hr());
    console.log(`  Final guest count (DB)   : ${finalCount}`);
    console.log(`  — with email             : ${finalWithEmail} (${pct(finalWithEmail, finalCount)}%)`);
    console.log(`  — tagged ${IMPORT_SOURCE.slice(0, 20)}: ${taggedCount}`);
    console.log(hr());
    console.log(`  Batches completed        : ${totalBatches}`);
    console.log(`  Import duration          : ${fmtMs(durationMs)}`);
    console.log(`  Restaurant               : ${restaurant.name}`);
    console.log(`  Restaurant ID            : ${restaurant.id}`);
    console.log(hr('═'));
    console.log();

    if (errorRows.length > 0) {
      console.error(`  WARNING: ${errorRows.length} rows failed. Error report: ${errorReportPath}\n`);
    } else {
      console.log('  All batches completed without errors.\n');
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('\nFatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
