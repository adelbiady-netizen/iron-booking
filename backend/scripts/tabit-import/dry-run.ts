#!/usr/bin/env ts-node
/**
 * Tabit CRM Export — Dry Run Analyzer
 *
 * Usage:
 *   ts-node --transpile-only scripts/tabit-import/dry-run.ts <path-to-csv-or-xlsx>
 *
 * What it does:
 *   - Parses the Tabit export (CSV or XLSX, Hebrew headers: שם, טלפון, מייל)
 *   - Reads the first worksheet for XLSX files
 *   - Normalizes phones, names, emails
 *   - Reports statistics: valid / invalid / duplicate / email coverage
 *   - Writes a JSON report alongside the file for review
 *
 * What it does NOT do:
 *   - Write to the database
 *   - Create or modify any guest records
 *   - Make any network calls
 *
 * After reviewing the report, run import.ts to perform the actual import.
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

// ── Column header aliases (Tabit Hebrew exports) ───────────────────────────────
const COL_PHONE = 'טלפון';
const COL_NAME  = 'שם';
const COL_EMAIL = 'מייל';

// Import source tag — change per restaurant / batch
const IMPORT_SOURCE = 'tabit_import_deli_italiano_2026';

// ── Types ─────────────────────────────────────────────────────────────────────

type PhoneFormat = 'international_il' | 'local_il' | 'other' | 'empty';

interface RawRow {
  lineNumber: number;
  rawPhone: string;
  rawName:  string;
  rawEmail: string;
}

interface ProcessedRow extends RawRow {
  phoneNormalized: string;
  nameNormalized:  string;
  emailNormalized: string;
  phoneFormat:     PhoneFormat;
  isValidPhone:    boolean;
  isValidName:     boolean;
  isValidEmail:    boolean;
  issues:          string[];
  isDuplicate:     boolean;  // set after dedup pass
}

interface DryRunReport {
  file:             string;
  source:           string;
  generatedAt:      string;
  totalRows:        number;
  validRows:        number;
  invalidRows:      number;
  duplicatesInFile: number;
  uniqueValidRows:  number;
  rowsWithEmail:    number;
  rowsWithoutName:  number;
  rowsWithoutPhone: number;
  phoneFormats:     Record<PhoneFormat, number>;
  issues:           Record<string, number>;
  invalidSample:    ProcessedRow[];
  duplicateSample:  Array<{ normalizedPhone: string; count: number; rows: RawRow[] }>;
  validSample:      ProcessedRow[];
  importReadyCount: number;
  warning:          string;
}

// ── Phone normalization ────────────────────────────────────────────────────────
// Target format: Israeli local mobile — 05XXXXXXXX (10 digits)
// Compatible with the telephony caller-ID normalization in frontend/src/utils/phone.ts

function normalizePhoneForImport(raw: string): { normalized: string; format: PhoneFormat } {
  const stripped = raw.replace(/[\s\-().+]/g, '').trim();

  if (!stripped) return { normalized: '', format: 'empty' };

  // +972XXXXXXXXX → remove the digits we'll re-add as 0
  const withPlus = raw.replace(/[\s\-()‏‎]/g, '').trim();
  if (withPlus.startsWith('+972')) {
    const local = '0' + withPlus.slice(4).replace(/\D/g, '');
    return { normalized: local, format: 'international_il' };
  }

  // 972XXXXXXXXX (no +, just digits starting with 972)
  if (/^972\d{9}$/.test(stripped)) {
    const local = '0' + stripped.slice(3);
    return { normalized: local, format: 'international_il' };
  }

  // Already local: 05XXXXXXXX
  if (/^0\d{9}$/.test(stripped)) {
    return { normalized: stripped, format: 'local_il' };
  }

  // Short local without leading 0: 5XXXXXXXX (9 digits, Israeli mobile)
  if (/^5\d{8}$/.test(stripped)) {
    return { normalized: '0' + stripped, format: 'local_il' };
  }

  return { normalized: stripped, format: 'other' };
}

function isValidIsraeliMobile(normalized: string): boolean {
  // 05[0-9]{8} — standard Israeli mobile
  return /^05\d{8}$/.test(normalized);
}

// ── Name normalization ─────────────────────────────────────────────────────────

function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

// ── Email normalization ────────────────────────────────────────────────────────

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function checkEmail(email: string): boolean {
  return email.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

// ── Minimal CSV parser ─────────────────────────────────────────────────────────
// Handles: UTF-8 BOM, CRLF/LF, quoted fields, comma and semicolon delimiters.
// Does not handle multi-line quoted fields (not expected in this export).

function detectDelimiter(firstLine: string): ',' | ';' {
  const commas    = (firstLine.match(/,/g)    ?? []).length;
  const semicolons = (firstLine.match(/;/g)   ?? []).length;
  return semicolons > commas ? ';' : ',';
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function parseCSV(filePath: string): { headers: string[]; rows: RawRow[] } {
  let raw = fs.readFileSync(filePath);

  // Strip UTF-8 BOM if present (EF BB BF)
  if (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
    raw = raw.slice(3);
  }

  const text  = raw.toString('utf8');
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);

  if (lines.length < 2) throw new Error('CSV has fewer than 2 lines — no data rows found.');

  const delimiter = detectDelimiter(lines[0]);
  const headers   = parseCSVLine(lines[0], delimiter).map(h => h.trim());

  const phoneIdx = headers.findIndex(h => h === COL_PHONE);
  const nameIdx  = headers.findIndex(h => h === COL_NAME);
  const emailIdx = headers.findIndex(h => h === COL_EMAIL);

  if (phoneIdx === -1) throw new Error(`Column "${COL_PHONE}" not found. Headers found: ${headers.join(' | ')}`);
  if (nameIdx  === -1) throw new Error(`Column "${COL_NAME}" not found. Headers found: ${headers.join(' | ')}`);

  const rows: RawRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i], delimiter);
    rows.push({
      lineNumber: i + 1,
      rawPhone:   (fields[phoneIdx] ?? '').trim(),
      rawName:    (fields[nameIdx]  ?? '').trim(),
      rawEmail:   emailIdx !== -1 ? (fields[emailIdx] ?? '').trim() : '',
    });
  }

  return { headers, rows };
}

// ── XLSX parser ───────────────────────────────────────────────────────────────

function parseXLSX(filePath: string): { headers: string[]; rows: RawRow[] } {
  const workbook = XLSX.readFile(filePath, { type: 'file', codepage: 65001 });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('XLSX file has no worksheets.');

  const sheet = workbook.Sheets[sheetName];

  // header: true → first row becomes keys; defval: '' → empty cells return ''
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    header: 1,
    defval: '',
  }) as unknown[][];

  if (jsonRows.length < 2) throw new Error('XLSX sheet has fewer than 2 rows — no data rows found.');

  const rawHeaders = (jsonRows[0] as unknown[]).map(h => String(h ?? '').trim());

  const phoneIdx = rawHeaders.findIndex(h => h === COL_PHONE);
  const nameIdx  = rawHeaders.findIndex(h => h === COL_NAME);
  const emailIdx = rawHeaders.findIndex(h => h === COL_EMAIL);

  if (phoneIdx === -1) throw new Error(`Column "${COL_PHONE}" not found. Headers found: ${rawHeaders.join(' | ')}`);
  if (nameIdx  === -1) throw new Error(`Column "${COL_NAME}" not found. Headers found: ${rawHeaders.join(' | ')}`);

  const rows: RawRow[] = [];
  for (let i = 1; i < jsonRows.length; i++) {
    const fields = jsonRows[i] as unknown[];
    const rawPhone = String(fields[phoneIdx] ?? '').trim();
    const rawName  = String(fields[nameIdx]  ?? '').trim();
    const rawEmail = emailIdx !== -1 ? String(fields[emailIdx] ?? '').trim() : '';
    // skip entirely blank rows
    if (!rawPhone && !rawName && !rawEmail) continue;
    rows.push({ lineNumber: i + 1, rawPhone, rawName, rawEmail });
  }

  return { headers: rawHeaders, rows };
}

// ── Main ───────────────────────────────────────────────────────────────────────

function run() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: ts-node --transpile-only scripts/tabit-import/dry-run.ts <path-to-csv-or-xlsx>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const ext = path.extname(filePath).toLowerCase();

  console.log(`\n${'─'.repeat(60)}`);
  console.log('  Tabit Import — Dry Run');
  console.log(`  Source tag: ${IMPORT_SOURCE}`);
  console.log(`  File: ${filePath}`);
  console.log(`  Format: ${ext === '.xlsx' || ext === '.xls' ? 'Excel (XLSX)' : 'CSV'}`);
  console.log(`${'─'.repeat(60)}\n`);

  // ── Parse ──────────────────────────────────────────────────────────────────
  let headers: string[];
  let rawRows: RawRow[];

  try {
    if (ext === '.xlsx' || ext === '.xls') {
      ({ headers, rows: rawRows } = parseXLSX(filePath));
    } else {
      ({ headers, rows: rawRows } = parseCSV(filePath));
    }
  } catch (err) {
    console.error('Parse error:', (err as Error).message);
    process.exit(1);
  }

  console.log(`Headers detected: ${headers.join(' | ')}`);
  console.log(`Total data rows: ${rawRows.length}\n`);

  // ── Process each row ───────────────────────────────────────────────────────
  const processed: ProcessedRow[] = rawRows.map(row => {
    const issues: string[] = [];
    const { normalized: phoneNormalized, format: phoneFormat } = normalizePhoneForImport(row.rawPhone);
    const nameNormalized  = normalizeName(row.rawName);
    const emailNormalized = normalizeEmail(row.rawEmail);

    const isValidPhone = isValidIsraeliMobile(phoneNormalized);
    const isValidName  = nameNormalized.length > 0;
    const isValidEmail = checkEmail(emailNormalized);

    if (!isValidPhone) {
      if (!row.rawPhone) issues.push('missing phone');
      else if (phoneFormat === 'other') issues.push(`unrecognized phone format: "${row.rawPhone}"`);
      else issues.push(`phone does not normalize to Israeli mobile: "${row.rawPhone}" → "${phoneNormalized}"`);
    }
    if (!isValidName) issues.push('missing name');

    return {
      ...row,
      phoneNormalized,
      nameNormalized,
      emailNormalized,
      phoneFormat,
      isValidPhone,
      isValidName,
      isValidEmail,
      issues,
      isDuplicate: false,
    };
  });

  // ── Deduplication pass (within import file) ────────────────────────────────
  const phoneCount = new Map<string, ProcessedRow[]>();

  for (const row of processed) {
    if (!row.isValidPhone) continue;
    const group = phoneCount.get(row.phoneNormalized) ?? [];
    group.push(row);
    phoneCount.set(row.phoneNormalized, group);
  }

  const duplicateGroups: Array<{ normalizedPhone: string; count: number; rows: RawRow[] }> = [];

  for (const [phone, group] of phoneCount.entries()) {
    if (group.length > 1) {
      // Mark all but the first as duplicate
      for (let i = 1; i < group.length; i++) {
        group[i].isDuplicate = true;
        group[i].issues.push(`duplicate of line ${group[0].lineNumber}`);
      }
      duplicateGroups.push({
        normalizedPhone: phone,
        count: group.length,
        rows: group.map(r => ({ lineNumber: r.lineNumber, rawPhone: r.rawPhone, rawName: r.rawName, rawEmail: r.rawEmail })),
      });
    }
  }

  // ── Tally stats ────────────────────────────────────────────────────────────
  const validRows      = processed.filter(r => r.isValidPhone && r.isValidName && !r.isDuplicate);
  const invalidRows    = processed.filter(r => !r.isValidPhone || !r.isValidName);
  const duplicateRows  = processed.filter(r => r.isDuplicate);
  const withEmail      = processed.filter(r => r.isValidEmail);
  const missingPhone   = processed.filter(r => !r.rawPhone);
  const missingName    = processed.filter(r => !r.isValidName);

  const phoneFormats: Record<PhoneFormat, number> = {
    international_il: 0,
    local_il:         0,
    other:            0,
    empty:            0,
  };
  const issueCounts: Record<string, number> = {};

  for (const row of processed) {
    phoneFormats[row.phoneFormat]++;
    for (const issue of row.issues) {
      const key = issue.startsWith('duplicate') ? 'duplicate phone in file' : issue;
      issueCounts[key] = (issueCounts[key] ?? 0) + 1;
    }
  }

  // ── Print report ───────────────────────────────────────────────────────────
  console.log('━━━  STATISTICS  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`  Total rows               : ${rawRows.length}`);
  console.log(`  Valid (phone + name)     : ${validRows.length}`);
  console.log(`  Invalid rows             : ${invalidRows.length}`);
  console.log(`  Duplicates in file       : ${duplicateRows.length}`);
  console.log(`  Unique import-ready rows : ${validRows.length}   ← will be written to DB`);
  console.log(`  Rows with email          : ${withEmail.length} (${pct(withEmail.length, rawRows.length)}%)`);
  console.log(`  Rows missing phone       : ${missingPhone.length}`);
  console.log(`  Rows missing name        : ${missingName.length}`);

  console.log('\n━━━  PHONE FORMATS  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`  +972 international → 05X : ${phoneFormats.international_il}`);
  console.log(`  05X local already        : ${phoneFormats.local_il}`);
  console.log(`  Other / unrecognized     : ${phoneFormats.other}`);
  console.log(`  Empty                    : ${phoneFormats.empty}`);

  if (Object.keys(issueCounts).length > 0) {
    console.log('\n━━━  ISSUES  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    for (const [issue, count] of Object.entries(issueCounts)) {
      console.log(`  ${count.toString().padStart(4)}x  ${issue}`);
    }
  }

  if (duplicateGroups.length > 0) {
    console.log('\n━━━  DUPLICATE SAMPLE (first 5)  ━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    for (const g of duplicateGroups.slice(0, 5)) {
      console.log(`  ${g.normalizedPhone}  (${g.count} rows):`);
      for (const r of g.rows) {
        console.log(`    line ${String(r.lineNumber).padStart(4)}: "${r.rawName}" | raw: "${r.rawPhone}"`);
      }
    }
  }

  if (invalidRows.length > 0) {
    console.log('\n━━━  INVALID ROWS SAMPLE (first 10)  ━━━━━━━━━━━━━━━━━━━━━━\n');
    for (const row of invalidRows.slice(0, 10)) {
      console.log(`  line ${String(row.lineNumber).padStart(4)}: "${row.rawName}" | phone: "${row.rawPhone}"`);
      for (const issue of row.issues) {
        console.log(`             ↳ ${issue}`);
      }
    }
  }

  console.log('\n━━━  VALID SAMPLE (first 5)  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  for (const row of validRows.slice(0, 5)) {
    console.log(`  line ${String(row.lineNumber).padStart(4)}: "${row.nameNormalized}" | ${row.phoneNormalized}${row.emailNormalized ? ` | ${row.emailNormalized}` : ''}`);
  }

  // ── JSON report ────────────────────────────────────────────────────────────
  const report: DryRunReport = {
    file:             path.resolve(filePath),
    source:           IMPORT_SOURCE,
    generatedAt:      new Date().toISOString(),
    totalRows:        rawRows.length,
    validRows:        processed.filter(r => r.isValidPhone && r.isValidName).length,
    invalidRows:      invalidRows.length,
    duplicatesInFile: duplicateRows.length,
    uniqueValidRows:  validRows.length,
    rowsWithEmail:    withEmail.length,
    rowsWithoutName:  missingName.length,
    rowsWithoutPhone: missingPhone.length,
    phoneFormats,
    issues:           issueCounts,
    invalidSample:    invalidRows.slice(0, 20),
    duplicateSample:  duplicateGroups.slice(0, 10),
    validSample:      validRows.slice(0, 10),
    importReadyCount: validRows.length,
    warning:          'DRY RUN ONLY — no database writes performed.',
  };

  const reportPath = filePath.replace(/\.(csv|xlsx?)$/i, '') + '.dry-run-report.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Import-ready guests      : ${validRows.length}`);
  console.log(`  Report saved to          : ${reportPath}`);
  console.log(`${'─'.repeat(60)}\n`);
  console.log('  ✓ Dry run complete. Review report before running import.ts\n');
}

function pct(n: number, total: number): string {
  if (total === 0) return '0';
  return Math.round((n / total) * 100).toString();
}

run();
