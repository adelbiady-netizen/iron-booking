#!/usr/bin/env ts-node
/**
 * Tabit CRM Merge Analysis
 *
 * Compares a new Tabit XLSX export against existing production guests and
 * produces a full merge report WITHOUT writing anything to the database.
 *
 * Usage:
 *   DATABASE_URL=... npx ts-node --transpile-only scripts/tabit-import/merge-analysis.ts \
 *     --file "path/to/new-export.xlsx" \
 *     --restaurant <slug>
 *
 * Reports per row:
 *   new            – phone and email not in DB → would be created
 *   existing_phone – same normalized phone found → would be skipped
 *   existing_email – same email found (different phone) → would be skipped
 *   conflict_name  – same phone but name differs significantly
 *   conflict_phone – same email but phone differs
 *   invalid        – landline / foreign / garbage / no name
 *   file_duplicate – duplicate within this file
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import dotenv    from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg }     from '@prisma/adapter-pg';

dotenv.config();

// ── Constants ─────────────────────────────────────────────────────────────────

const COL_PHONE  = 'טלפון';
const COL_NAME   = 'שם';
const COL_EMAIL  = 'מייל';

// ── Phone normalization (Israeli mobile only) ──────────────────────────────────

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
  if (/^5\d{8}$/.test(cleaned))  return '0' + cleaned;
  return null;
}

function normalizeEmail(raw: string): string | null {
  const clean = raw.trim().toLowerCase();
  if (!clean) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean) ? clean : null;
}

function splitName(raw: string): { firstName: string; lastName: string } {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  const idx = trimmed.indexOf(' ');
  if (idx === -1) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1) };
}

function fullName(first: string, last: string): string {
  return `${first} ${last}`.trim();
}

// ── XLSX loader ────────────────────────────────────────────────────────────────

interface RawRow { lineNumber: number; rawPhone: string; rawName: string; rawEmail: string; }

function loadXLSX(filePath: string): RawRow[] {
  const wb    = XLSX.readFile(filePath, { type: 'file', codepage: 65001 });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('XLSX has no worksheets.');

  const rows  = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][];
  if (rows.length < 2) throw new Error('Sheet has fewer than 2 rows.');

  const headers  = (rows[0] as unknown[]).map(h => String(h ?? '').trim());
  const phoneIdx = headers.findIndex(h => h === COL_PHONE);
  const nameIdx  = headers.findIndex(h => h === COL_NAME);
  const emailIdx = headers.findIndex(h => h === COL_EMAIL);

  if (phoneIdx === -1) throw new Error(`Column "${COL_PHONE}" not found. Found: ${headers.join(' | ')}`);
  if (nameIdx  === -1) throw new Error(`Column "${COL_NAME}" not found. Found: ${headers.join(' | ')}`);

  const result: RawRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const f = rows[i] as unknown[];
    const rawPhone = String(f[phoneIdx] ?? '').trim();
    const rawName  = String(f[nameIdx]  ?? '').trim();
    const rawEmail = emailIdx !== -1 ? String(f[emailIdx] ?? '').trim() : '';
    if (!rawPhone && !rawName && !rawEmail) continue;
    result.push({ lineNumber: i + 1, rawPhone, rawName, rawEmail });
  }
  return result;
}

// ── Name similarity (loose check for conflict detection) ──────────────────────
// Returns true if names are meaningfully different (not just whitespace/case).

function namesDiffer(a: string, b: string): boolean {
  const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return clean(a) !== clean(b);
}

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let filePath: string | undefined;
  let restaurantSlug: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file'       && args[i + 1]) { filePath       = args[++i]; continue; }
    if (args[i] === '--restaurant' && args[i + 1]) { restaurantSlug = args[++i]; continue; }
  }
  return { filePath, restaurantSlug };
}

function hr(char = '─', w = 62) { return char.repeat(w); }
function pct(n: number, total: number) {
  return total === 0 ? '0' : Math.round((n / total) * 100).toString();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { filePath, restaurantSlug } = parseArgs();

  if (!filePath || !restaurantSlug) {
    console.error([
      '',
      'Usage:',
      '  DATABASE_URL=... npx ts-node --transpile-only scripts/tabit-import/merge-analysis.ts \\',
      '    --file "path/to/export.xlsx" --restaurant <slug>',
      '',
    ].join('\n'));
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1); }

  const url = process.env.DATABASE_URL ?? '';
  try {
    const { hostname } = new URL(url);
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      console.error('ABORT: DATABASE_URL points to localhost. Use production URL.');
      process.exit(1);
    }
    console.log(`DB host  : ${hostname}  ✓`);
  } catch { console.error('DATABASE_URL missing or invalid.'); process.exit(1); }

  console.log(`\n${hr('═')}`);
  console.log('  Tabit CRM Merge Analysis — DRY RUN (no writes)');
  console.log(`  File       : ${path.basename(filePath)}`);
  console.log(`  Restaurant : ${restaurantSlug}`);
  console.log(`${hr('═')}\n`);

  // ── Load file ───────────────────────────────────────────────────────────────
  console.log('Step 1: Loading file...');
  const rawRows = loadXLSX(filePath);
  console.log(`  ${rawRows.length} data rows.\n`);

  // ── Validate rows ───────────────────────────────────────────────────────────
  interface ParsedRow {
    lineNumber: number;
    firstName:  string;
    lastName:   string;
    phone:      string;
    email:      string | null;
    rawPhone:   string;
    rawName:    string;
  }

  const validRows: ParsedRow[] = [];
  let invalidCount = 0;

  for (const row of rawRows) {
    const phone = normalizePhone(row.rawPhone);
    if (!phone || !row.rawName.trim()) { invalidCount++; continue; }
    const { firstName, lastName } = splitName(row.rawName);
    validRows.push({
      lineNumber: row.lineNumber,
      firstName, lastName,
      phone,
      email:    normalizeEmail(row.rawEmail),
      rawPhone: row.rawPhone,
      rawName:  row.rawName,
    });
  }

  console.log(`Step 2: Validation`);
  console.log(`  ${validRows.length} valid mobile rows`);
  console.log(`  ${invalidCount} skipped (landline / foreign / garbage / no name)\n`);

  // ── Dedup within file ────────────────────────────────────────────────────────
  const seenPhones  = new Set<string>();
  const seenEmails  = new Set<string>();
  const deduped:    ParsedRow[] = [];
  const fileDupes:  ParsedRow[] = [];

  for (const row of validRows) {
    if (seenPhones.has(row.phone)) { fileDupes.push(row); continue; }
    if (row.email && seenEmails.has(row.email)) { fileDupes.push(row); continue; }
    seenPhones.add(row.phone);
    if (row.email) seenEmails.add(row.email);
    deduped.push(row);
  }

  console.log(`Step 3: Within-file dedup`);
  console.log(`  ${deduped.length} unique rows`);
  console.log(`  ${fileDupes.length} within-file duplicates removed\n`);

  // ── Connect to DB ────────────────────────────────────────────────────────────
  console.log('Step 4: Loading production guests...');
  const adapter = new PrismaPg({ connectionString: url });
  const prisma  = new PrismaClient({ adapter, log: ['error'] });

  try {
    const restaurant = await prisma.restaurant.findUnique({
      where:  { slug: restaurantSlug },
      select: { id: true, name: true },
    });

    if (!restaurant) {
      const all = await prisma.restaurant.findMany({
        where: { isSystem: false }, select: { slug: true, name: true }, orderBy: { name: 'asc' },
      });
      console.error(`\n  Restaurant "${restaurantSlug}" not found.`);
      all.forEach(r => console.error(`    ${r.slug.padEnd(35)} "${r.name}"`));
      process.exit(1);
    }

    console.log(`  Restaurant: "${restaurant.name}" (${restaurant.id})`);

    // Load all existing guests into lookup maps
    const existing = await prisma.guest.findMany({
      where:  { restaurantId: restaurant.id },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true },
    });

    console.log(`  ${existing.length} existing guests loaded.\n`);

    // Build lookup maps (normalized phone → guest, email → guest)
    interface DbGuest { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; }
    const phoneMap = new Map<string, DbGuest>();
    const emailMap = new Map<string, DbGuest>();

    for (const g of existing) {
      if (g.phone) {
        const norm = normalizePhone(g.phone);
        if (norm) phoneMap.set(norm, g);
      }
      if (g.email) emailMap.set(g.email.toLowerCase().trim(), g);
    }

    // ── Merge classification ───────────────────────────────────────────────────
    interface MergeResult {
      row:       ParsedRow;
      outcome:   'new' | 'existing_phone' | 'existing_email' | 'conflict_name' | 'conflict_phone';
      dbGuest?:  DbGuest;
      detail?:   string;
    }

    const results: MergeResult[] = [];

    for (const row of deduped) {
      const byPhone = phoneMap.get(row.phone);

      if (byPhone) {
        // Phone match — check if name differs meaningfully
        const importName = fullName(row.firstName, row.lastName);
        const dbName     = fullName(byPhone.firstName, byPhone.lastName);
        if (namesDiffer(importName, dbName)) {
          results.push({
            row, outcome: 'conflict_name', dbGuest: byPhone,
            detail: `Import: "${importName}" vs DB: "${dbName}"`,
          });
        } else {
          results.push({ row, outcome: 'existing_phone', dbGuest: byPhone });
        }
        continue;
      }

      if (row.email) {
        const byEmail = emailMap.get(row.email);
        if (byEmail) {
          // Email match — check if phone differs
          const dbPhoneNorm = byEmail.phone ? normalizePhone(byEmail.phone) : null;
          if (dbPhoneNorm && dbPhoneNorm !== row.phone) {
            results.push({
              row, outcome: 'conflict_phone', dbGuest: byEmail,
              detail: `Import phone: ${row.phone} vs DB phone: ${dbPhoneNorm}`,
            });
          } else {
            results.push({ row, outcome: 'existing_email', dbGuest: byEmail });
          }
          continue;
        }
      }

      results.push({ row, outcome: 'new' });
    }

    // ── Tally ─────────────────────────────────────────────────────────────────
    const newGuests       = results.filter(r => r.outcome === 'new');
    const existByPhone    = results.filter(r => r.outcome === 'existing_phone');
    const existByEmail    = results.filter(r => r.outcome === 'existing_email');
    const conflictName    = results.filter(r => r.outcome === 'conflict_name');
    const conflictPhone   = results.filter(r => r.outcome === 'conflict_phone');
    const newWithEmail    = newGuests.filter(r => r.row.email !== null);

    // ── Print summary ─────────────────────────────────────────────────────────
    console.log(hr());
    console.log('  MERGE ANALYSIS RESULTS');
    console.log(hr());
    console.log(`  Total rows in file           : ${rawRows.length}`);
    console.log(`  Valid mobile rows            : ${validRows.length}`);
    console.log(`  Invalid (landline/foreign)   : ${invalidCount}`);
    console.log(`  Within-file duplicates       : ${fileDupes.length}`);
    console.log(`  Unique rows checked vs DB    : ${deduped.length}`);
    console.log(hr('·'));
    console.log(`  NEW guests (would create)    : ${newGuests.length}`);
    console.log(`    — of which with email      : ${newWithEmail.length} (${pct(newWithEmail.length, newGuests.length)}%)`);
    console.log(`  Existing match by phone      : ${existByPhone.length}  (skip, preserve)`);
    console.log(`  Existing match by email      : ${existByEmail.length}  (skip, preserve)`);
    console.log(`  Conflict: same phone ≠ name  : ${conflictName.length}  ← review needed`);
    console.log(`  Conflict: same email ≠ phone : ${conflictPhone.length}  ← review needed`);
    console.log(hr());
    console.log();

    // ── Sample new guests ──────────────────────────────────────────────────────
    if (newGuests.length > 0) {
      console.log('  SAMPLE NEW GUESTS (first 8):');
      for (const r of newGuests.slice(0, 8)) {
        const name  = fullName(r.row.firstName, r.row.lastName);
        const email = r.row.email ? ` | ${r.row.email}` : '';
        console.log(`    line ${String(r.row.lineNumber).padStart(5)}: "${name}" | ${r.row.phone}${email}`);
      }
      console.log();
    }

    // ── Sample existing (phone match) ──────────────────────────────────────────
    if (existByPhone.length > 0) {
      console.log('  SAMPLE EXISTING BY PHONE (first 5):');
      for (const r of existByPhone.slice(0, 5)) {
        const importName = fullName(r.row.firstName, r.row.lastName);
        const dbName     = r.dbGuest ? fullName(r.dbGuest.firstName, r.dbGuest.lastName) : '?';
        console.log(`    line ${String(r.row.lineNumber).padStart(5)}: ${r.row.phone}  import="${importName}"  db="${dbName}"`);
      }
      console.log();
    }

    // ── Name conflicts ─────────────────────────────────────────────────────────
    if (conflictName.length > 0) {
      console.log(`  NAME CONFLICTS — same phone, different name (all ${conflictName.length}):`);
      for (const r of conflictName) {
        console.log(`    line ${String(r.row.lineNumber).padStart(5)}: ${r.row.phone}`);
        console.log(`             Import : "${fullName(r.row.firstName, r.row.lastName)}"`);
        console.log(`             DB     : "${r.dbGuest ? fullName(r.dbGuest.firstName, r.dbGuest.lastName) : '?'}"`);
      }
      console.log();
    }

    // ── Phone conflicts ────────────────────────────────────────────────────────
    if (conflictPhone.length > 0) {
      console.log(`  PHONE CONFLICTS — same email, different phone (all ${conflictPhone.length}):`);
      for (const r of conflictPhone) {
        const dbPhoneNorm = r.dbGuest?.phone ? normalizePhone(r.dbGuest.phone) : '?';
        console.log(`    line ${String(r.row.lineNumber).padStart(5)}: email=${r.row.email}`);
        console.log(`             Import phone : ${r.row.phone}`);
        console.log(`             DB phone     : ${dbPhoneNorm}`);
        console.log(`             Name         : "${fullName(r.row.firstName, r.row.lastName)}"`);
      }
      console.log();
    }

    // ── Write JSON report ──────────────────────────────────────────────────────
    const reportPath = filePath.replace(/\.(csv|xlsx?)$/i, '') + '.merge-analysis.json';
    const report = {
      file:           path.resolve(filePath),
      restaurant:     restaurant.name,
      restaurantId:   restaurant.id,
      generatedAt:    new Date().toISOString(),
      existingGuests: existing.length,
      summary: {
        totalRowsInFile:      rawRows.length,
        validMobileRows:      validRows.length,
        invalidRows:          invalidCount,
        withinFileDuplicates: fileDupes.length,
        uniqueCheckedVsDb:    deduped.length,
        newGuests:            newGuests.length,
        newGuestsWithEmail:   newWithEmail.length,
        existingByPhone:      existByPhone.length,
        existingByEmail:      existByEmail.length,
        conflictName:         conflictName.length,
        conflictPhone:        conflictPhone.length,
      },
      samples: {
        newGuests:     newGuests.slice(0, 20).map(r => ({
          line: r.row.lineNumber,
          name: fullName(r.row.firstName, r.row.lastName),
          phone: r.row.phone,
          email: r.row.email,
        })),
        existingByPhone: existByPhone.slice(0, 10).map(r => ({
          line:       r.row.lineNumber,
          phone:      r.row.phone,
          importName: fullName(r.row.firstName, r.row.lastName),
          dbName:     r.dbGuest ? fullName(r.dbGuest.firstName, r.dbGuest.lastName) : null,
        })),
        conflictName: conflictName.map(r => ({
          line:       r.row.lineNumber,
          phone:      r.row.phone,
          importName: fullName(r.row.firstName, r.row.lastName),
          dbName:     r.dbGuest ? fullName(r.dbGuest.firstName, r.dbGuest.lastName) : null,
          dbId:       r.dbGuest?.id,
        })),
        conflictPhone: conflictPhone.map(r => ({
          line:        r.row.lineNumber,
          email:       r.row.email,
          importPhone: r.row.phone,
          dbPhone:     r.dbGuest?.phone ? normalizePhone(r.dbGuest.phone) : null,
          name:        fullName(r.row.firstName, r.row.lastName),
          dbId:        r.dbGuest?.id,
        })),
      },
      warning: 'DRY RUN — no database writes performed.',
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(`${hr('═')}`);
    console.log(`  New guests that would be created : ${newGuests.length}`);
    console.log(`  Conflicts requiring review       : ${conflictName.length + conflictPhone.length}`);
    console.log(`  Report saved to                  : ${path.basename(reportPath)}`);
    console.log(`${hr('═')}\n`);
    console.log('  DRY RUN COMPLETE — no writes performed.\n');

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
