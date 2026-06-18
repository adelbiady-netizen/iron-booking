#!/usr/bin/env ts-node
/**
 * Tabit CRM Merge Import — additive-only, non-destructive.
 *
 * Dry-run (default — no DB writes):
 *   DATABASE_URL=... npx ts-node --transpile-only scripts/tabit-import/merge-import.ts \
 *     --file "path/to/export.xlsx" --restaurant italiano-dalla-costa
 *
 * Live import (writes to DB):
 *   DATABASE_URL=... npx ts-node --transpile-only scripts/tabit-import/merge-import.ts \
 *     --file "path/to/export.xlsx" --restaurant italiano-dalla-costa --execute
 *
 * Safety guarantees:
 *   - Dry-run by default. --execute required for any DB writes.
 *   - Mobile-only: /^05\d{8}$/ only. Landlines → rejected.
 *   - ADDITIVE ONLY: existing guests are NEVER modified.
 *   - Phone match (any name)       → skip, preserve DB record.
 *   - Email match (different phone) → skip, preserve DB record.
 *   - No fuzzy matching, no auto-merging, no name overwriting.
 *   - Source tag: tabit_import_deli_italiano_2026_v2
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
const IMPORT_SOURCE = 'tabit_import_deli_italiano_2026_v2';
const TARGET_SLUG   = 'italiano-dalla-costa';
const BATCH_SIZE    = 250;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedRow {
  lineNumber: number;
  firstName:  string;
  lastName:   string;
  phone:      string;
  email:      string | null;
}

type RowCategory =
  | 'new'
  | 'existing_phone'    // phone in DB, name same → skip
  | 'conflict_name'     // phone in DB, name differs → skip
  | 'conflict_phone'    // email in DB, different phone → skip
  | 'existing_email';   // email in DB, same phone → skip (shouldn't occur post-dedup)

interface CategorizedRow {
  row:      ParsedRow;
  category: RowCategory;
}

interface DbGuest {
  phone: string | null;
  email: string | null;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string | null {
  const cleaned  = raw.replace(/[\s\-()+]/g, '').trim();
  if (!cleaned) return null;

  const withPlus = raw.replace(/[\s\-()‎‏]/g, '').trim();

  if (withPlus.startsWith('+972')) {
    const local = '0' + withPlus.slice(4).replace(/\D/g, '');
    return /^05\d{8}$/.test(local) ? local : null;
  }
  if (/^972\d{9}$/.test(cleaned)) {
    const local = '0' + cleaned.slice(3);
    return /^05\d{8}$/.test(local) ? local : null;
  }
  if (/^05\d{8}$/.test(cleaned)) return cleaned;
  if (/^5\d{8}$/.test(cleaned))  return /^05\d{8}$/.test('0' + cleaned) ? '0' + cleaned : null;

  return null;
}

function normalizeEmail(raw: string): string | null {
  const clean = raw.trim().toLowerCase();
  if (!clean) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean) ? clean : null;
}

function splitName(raw: string): { firstName: string; lastName: string } {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  const idx     = trimmed.indexOf(' ');
  if (idx === -1) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1) };
}

function namesDiffer(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
  return norm(a) !== norm(b);
}

function pct(n: number, total: number): string {
  return total === 0 ? '0' : Math.round((n / total) * 100).toString();
}

function hr(char = '─', width = 64): string {
  return char.repeat(width);
}

function fmtMs(ms: number): string {
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function assertNotLocalhost(url: string, step: string): void {
  try {
    const { hostname } = new URL(url);
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      console.error(`\n  ABORT [${step}]: DATABASE_URL points to localhost.`);
      console.error('  Set DATABASE_URL to the production connection string.\n');
      process.exit(1);
    }
    console.log(`  DB host  : ${hostname}  ✓`);
  } catch {
    console.error('  ABORT: DATABASE_URL is not a valid URL.');
    process.exit(1);
  }
}

// ── XLSX loader ────────────────────────────────────────────────────────────────

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

  if (phoneIdx === -1) throw new Error(`Column "${COL_PHONE}" not found. Headers: ${headers.join(' | ')}`);
  if (nameIdx  === -1) throw new Error(`Column "${COL_NAME}" not found. Headers: ${headers.join(' | ')}`);

  const rows: RawRow[] = [];
  for (let i = 1; i < jsonRows.length; i++) {
    const fields   = jsonRows[i] as unknown[];
    const rawPhone = String(fields[phoneIdx] ?? '').trim();
    const rawName  = String(fields[nameIdx]  ?? '').trim();
    const rawEmail = emailIdx !== -1 ? String(fields[emailIdx] ?? '').trim() : '';
    if (!rawPhone && !rawName && !rawEmail) continue;
    rows.push({ lineNumber: i + 1, rawPhone, rawName, rawEmail });
  }

  return rows;
}

// ── CLI ────────────────────────────────────────────────────────────────────────

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

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const { filePath, restaurantSlug, execute } = parseArgs();

  if (!filePath || !restaurantSlug) {
    console.error([
      '',
      'Usage:',
      '  DATABASE_URL=... npx ts-node --transpile-only scripts/tabit-import/merge-import.ts \\',
      '    --file "path/to/export.xlsx" \\',
      '    --restaurant italiano-dalla-costa \\',
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

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  // ── Pre-flight ────────────────────────────────────────────────────────────
  assertNotLocalhost(connectionString, 'pre-flight');

  // Slug guard — this script is scoped to a single restaurant
  if (restaurantSlug !== TARGET_SLUG) {
    console.error(`\n  ABORT: slug "${restaurantSlug}" is not allowed by this script.`);
    console.error(`  This merge-import is scoped to: ${TARGET_SLUG}\n`);
    process.exit(1);
  }

  const mode = execute ? '⚠  LIVE IMPORT — writing to database' : 'DRY RUN — no database writes';

  console.log(`\n${hr('═')}`);
  console.log('  Tabit CRM Merge Import (additive-only)');
  console.log(`  Mode         : ${mode}`);
  console.log(`  Source tag   : ${IMPORT_SOURCE}`);
  console.log(`  File         : ${path.basename(filePath)}`);
  console.log(`  Restaurant   : ${restaurantSlug}`);
  console.log(`${hr('═')}\n`);

  // ── Step 1: Load and validate ─────────────────────────────────────────────
  console.log('Step 1: Loading file...');
  const rawRows = loadXLSX(filePath);
  console.log(`  ${rawRows.length.toLocaleString()} total data rows.\n`);

  const validRows: ParsedRow[] = [];
  let skippedInvalid = 0;

  for (const row of rawRows) {
    const phone = normalizePhone(row.rawPhone);
    if (!phone || !row.rawName.trim()) { skippedInvalid++; continue; }
    const { firstName, lastName } = splitName(row.rawName);
    const email = normalizeEmail(row.rawEmail);
    validRows.push({ lineNumber: row.lineNumber, firstName, lastName, phone, email });
  }

  console.log(`  ${validRows.length.toLocaleString()} valid mobile rows`);
  console.log(`  ${skippedInvalid.toLocaleString()} skipped (landline / foreign / no phone / no name)\n`);

  // ── Step 2: Deduplicate within file ───────────────────────────────────────
  console.log('Step 2: Deduplicating within file...');

  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();
  const deduped: ParsedRow[] = [];
  let skippedFileDupe = 0;

  for (const row of validRows) {
    if (seenPhones.has(row.phone))                  { skippedFileDupe++; continue; }
    if (row.email && seenEmails.has(row.email))     { skippedFileDupe++; continue; }
    seenPhones.add(row.phone);
    if (row.email) seenEmails.add(row.email);
    deduped.push(row);
  }

  console.log(`  ${deduped.length.toLocaleString()} unique rows after removing ${skippedFileDupe.toLocaleString()} within-file duplicates.\n`);

  // ── Step 3: Connect to database ───────────────────────────────────────────
  console.log('Step 3: Connecting to database...');
  assertNotLocalhost(connectionString, 'Step 3');

  const adapter = new PrismaPg({ connectionString });
  const prisma  = new PrismaClient({ adapter, log: ['error'] });

  try {
    // ── Step 4: Verify restaurant ──────────────────────────────────────────
    console.log('\nStep 4: Verifying restaurant...');

    const restaurant = await prisma.restaurant.findUnique({
      where:  { slug: restaurantSlug },
      select: { id: true, name: true, slug: true },
    });

    if (!restaurant) {
      console.error(`\n  ERROR: Restaurant "${restaurantSlug}" not found in DB.`);
      process.exit(1);
    }

    console.log(`  Slug     : ${restaurant.slug}`);
    console.log(`  Name     : ${restaurant.name}`);
    console.log(`  ID       : ${restaurant.id}\n`);

    // ── Step 5: Load all existing guests ──────────────────────────────────
    console.log('Step 5: Loading existing guests from DB...');

    const existingGuests = await prisma.guest.findMany({
      where:  { restaurantId: restaurant.id },
      select: { phone: true, email: true, firstName: true, lastName: true },
    });

    // phoneMap: normalized phone → {name, email}
    const phoneMap = new Map<string, { name: string; email: string | null }>();
    // emailMap: email → {name, phone}
    const emailMap = new Map<string, { name: string; phone: string | null }>();

    for (const g of existingGuests) {
      const normPhone = g.phone ? normalizePhone(g.phone) : null;
      const normEmail = g.email ? g.email.toLowerCase().trim() : null;
      const name      = `${g.firstName ?? ''} ${g.lastName ?? ''}`.trim();

      if (normPhone) phoneMap.set(normPhone, { name, email: normEmail });
      if (normEmail) emailMap.set(normEmail, { name, phone: normPhone });
    }

    console.log(`  ${existingGuests.length.toLocaleString()} existing guests loaded.`);
    console.log(`  ${phoneMap.size.toLocaleString()} unique phones indexed.`);
    console.log(`  ${emailMap.size.toLocaleString()} unique emails indexed.\n`);

    // ── Step 6: Classify each row ─────────────────────────────────────────
    console.log('Step 6: Classifying rows against existing DB...');

    const categorized: CategorizedRow[] = [];
    let countNew           = 0;
    let countExistingPhone = 0;
    let countConflictName  = 0;
    let countConflictPhone = 0;
    let countExistingEmail = 0;

    for (const row of deduped) {
      const importName = `${row.firstName} ${row.lastName}`.trim();
      const dbByPhone  = phoneMap.get(row.phone);

      if (dbByPhone) {
        // Phone already in DB — either same guest or name conflict
        if (namesDiffer(importName, dbByPhone.name)) {
          categorized.push({ row, category: 'conflict_name' });
          countConflictName++;
        } else {
          categorized.push({ row, category: 'existing_phone' });
          countExistingPhone++;
        }
        continue;
      }

      // No phone match — check email
      if (row.email) {
        const dbByEmail = emailMap.get(row.email);
        if (dbByEmail) {
          // Email in DB — same phone would mean exact duplicate (shouldn't happen
          // after Step 5 dedup), different phone means phone conflict
          const importNorm = normalizePhone(row.phone);
          if (dbByEmail.phone && importNorm && dbByEmail.phone === importNorm) {
            categorized.push({ row, category: 'existing_email' });
            countExistingEmail++;
          } else {
            categorized.push({ row, category: 'conflict_phone' });
            countConflictPhone++;
          }
          continue;
        }
      }

      // Neither phone nor email in DB → truly new
      categorized.push({ row, category: 'new' });
      countNew++;
    }

    const toCreate = categorized.filter(c => c.category === 'new').map(c => c.row);
    const withEmail = toCreate.filter(r => r.email !== null).length;

    // ── Plan summary ───────────────────────────────────────────────────────
    console.log();
    console.log(hr('═'));
    console.log('  MERGE PLAN (additive-only)');
    console.log(hr('═'));
    console.log(`  NEW guests to create       : ${countNew.toLocaleString()}`);
    console.log(`    — with email             : ${withEmail.toLocaleString()} (${pct(withEmail, countNew)}%)`);
    console.log(hr());
    console.log('  SKIPPED (existing — no changes to DB records):');
    console.log(`    Existing by phone        : ${countExistingPhone.toLocaleString()}`);
    console.log(`    Existing by email        : ${countExistingEmail.toLocaleString()}`);
    console.log('  SKIPPED (conflicts — preserving authoritative DB):');
    console.log(`    Name conflict (same ph)  : ${countConflictName.toLocaleString()}`);
    console.log(`    Phone conflict (same em) : ${countConflictPhone.toLocaleString()}`);
    console.log('  SKIPPED (pre-DB):');
    console.log(`    Within-file duplicates   : ${skippedFileDupe.toLocaleString()}`);
    console.log(`    Invalid/landline/garbage : ${skippedInvalid.toLocaleString()}`);
    console.log(hr());
    console.log(`  Total rows in file         : ${rawRows.length.toLocaleString()}`);
    console.log(hr('═'));

    if (toCreate.length > 0) {
      console.log('\n  SAMPLE — first 5 new guests:');
      for (const row of toCreate.slice(0, 5)) {
        const name  = `${row.firstName} ${row.lastName}`.trim();
        const email = row.email ? ` | ${row.email}` : '';
        console.log(`    line ${String(row.lineNumber).padStart(6)}: "${name}" | ${row.phone}${email}`);
      }
    }

    console.log();

    // ── Dry-run exit ───────────────────────────────────────────────────────
    if (!execute) {
      console.log('DRY RUN COMPLETE — no writes performed.');
      console.log(`Add --execute to import ${countNew.toLocaleString()} new guests.\n`);
      return;
    }

    if (toCreate.length === 0) {
      console.log('Nothing to create — all records already exist in DB.\n');
      return;
    }

    // ── Step 7: Execute batched creates ───────────────────────────────────
    // Re-assert host immediately before first write
    assertNotLocalhost(connectionString, 'Step 7 pre-write');

    const totalBatches = Math.ceil(toCreate.length / BATCH_SIZE);
    const importedAt   = new Date().toISOString().slice(0, 10);
    const internalNote = `Merged from Tabit CRM export. Source: ${IMPORT_SOURCE}. Date: ${importedAt}.`;

    interface ErrorRow { lineNumber: number; phone: string; name: string; error: string; }
    const errorRows: ErrorRow[] = [];
    let totalCreated   = 0;
    let totalDbSkipped = 0;
    const startMs      = Date.now();

    console.log(`EXECUTING: ${toCreate.length.toLocaleString()} guests across ${totalBatches} batches of ${BATCH_SIZE}...\n`);

    for (let b = 0; b < totalBatches; b++) {
      const batch = toCreate.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);

      const data = batch.map(row => ({
        restaurantId:  restaurant.id,
        firstName:     row.firstName,
        lastName:      row.lastName,
        phone:         row.phone,
        email:         row.email ?? null,
        tags:          [IMPORT_SOURCE],
        internalNotes: internalNote,
      }));

      try {
        const result    = await prisma.guest.createMany({ data, skipDuplicates: true });
        const dbSkipped = batch.length - result.count;
        totalCreated   += result.count;
        totalDbSkipped += dbSkipped;

        const elapsed  = fmtMs(Date.now() - startMs);
        const label    = `Batch ${String(b + 1).padStart(3)}/${totalBatches}`;
        const skipNote = dbSkipped > 0 ? `  [${dbSkipped} skipped by DB]` : '';
        console.log(`  ${label}  +${result.count} created  (${elapsed} elapsed)${skipNote}`);

      } catch (err) {
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

    // ── Step 8: Verify final state ─────────────────────────────────────────
    console.log('\nStep 8: Verifying final guest count...');

    const finalCount     = await prisma.guest.count({ where: { restaurantId: restaurant.id } });
    const finalWithEmail = await prisma.guest.count({
      where: { restaurantId: restaurant.id, email: { not: null } },
    });
    const taggedCount = await prisma.guest.count({
      where: { restaurantId: restaurant.id, tags: { has: IMPORT_SOURCE } },
    });

    // ── Error report ───────────────────────────────────────────────────────
    let errorReportPath: string | null = null;
    if (errorRows.length > 0) {
      errorReportPath = filePath.replace(/\.(csv|xlsx?)$/i, '') + '.merge-import-errors.json';
      fs.writeFileSync(
        errorReportPath,
        JSON.stringify({ generatedAt: new Date().toISOString(), errors: errorRows }, null, 2),
        'utf8',
      );
    }

    // ── Final report ───────────────────────────────────────────────────────
    const skippedExisting  = countExistingPhone + countExistingEmail;
    const skippedConflicts = countConflictName  + countConflictPhone;

    console.log();
    console.log(hr('═'));
    console.log('  IMPORT COMPLETE');
    console.log(hr('═'));
    console.log(`  Created                    : ${totalCreated.toLocaleString()}`);
    console.log(`  Failed (batch errors)      : ${errorRows.length.toLocaleString()}`);
    console.log(`  Skipped by DB constraint   : ${totalDbSkipped.toLocaleString()}`);
    console.log(hr());
    console.log('  Skipped — existing (not modified):');
    console.log(`    By phone                 : ${countExistingPhone.toLocaleString()}`);
    console.log(`    By email                 : ${countExistingEmail.toLocaleString()}`);
    console.log(`    Total existing           : ${skippedExisting.toLocaleString()}`);
    console.log('  Skipped — conflicts (DB preserved):');
    console.log(`    Name conflict            : ${countConflictName.toLocaleString()}`);
    console.log(`    Phone conflict           : ${countConflictPhone.toLocaleString()}`);
    console.log(`    Total conflicts          : ${skippedConflicts.toLocaleString()}`);
    console.log('  Skipped — pre-DB:');
    console.log(`    Within-file duplicates   : ${skippedFileDupe.toLocaleString()}`);
    console.log(`    Invalid/landline/garbage : ${skippedInvalid.toLocaleString()}`);
    console.log(hr());
    console.log(`  Final guest count (DB)     : ${finalCount.toLocaleString()}`);
    console.log(`  — with email               : ${finalWithEmail.toLocaleString()} (${pct(finalWithEmail, finalCount)}%)`);
    console.log(`  — tagged v2                : ${taggedCount.toLocaleString()}`);
    console.log(hr());
    console.log(`  Batches completed          : ${totalBatches}`);
    console.log(`  Import duration            : ${fmtMs(durationMs)}`);
    console.log(`  Restaurant                 : ${restaurant.name}`);
    console.log(`  Restaurant ID              : ${restaurant.id}`);
    console.log(hr('═'));
    console.log();

    // Anomalies
    const anomalies: string[] = [];
    if (totalDbSkipped > 0)
      anomalies.push(`${totalDbSkipped} rows skipped by DB unique constraint (unexpected — check data).`);
    if (errorRows.length > 0)
      anomalies.push(`${errorRows.length} batch errors. Report: ${errorReportPath}`);
    if (totalCreated < countNew)
      anomalies.push(`Expected ${countNew} creates but only got ${totalCreated} — possible constraint collisions.`);

    if (anomalies.length === 0) {
      console.log('  No anomalies detected. Import completed cleanly.\n');
    } else {
      console.warn('  ANOMALIES:');
      for (const a of anomalies) console.warn(`    ⚠  ${a}`);
      console.log();
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('\nFatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
