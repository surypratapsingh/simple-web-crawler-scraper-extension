import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ExportFormat = 'csv' | 'json' | 'ndjson';

/** Exports only ever land here; the model can choose a file *name*, never a directory. */
export function exportDir(): string {
  return process.env.SCRAPELINE_EXPORT_DIR || join(homedir(), '.scrapeline', 'exports');
}

// Spreadsheet apps evaluate cells starting with = @ (or +/- followed by a non-number) as formulas.
// Scraped text is untrusted, so neutralise those with a leading apostrophe.
function csvCell(v: string): string {
  let s = String(v ?? '');
  if (/^[=@\t\r]/.test(s) || /^[+-][^\d\s.]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: string[][]): string {
  const lines = [columns, ...rows].map((r) => r.map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n'; // BOM so Excel reads UTF-8
}

const objects = (columns: string[], rows: string[][]) =>
  rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])));

export function serialize(columns: string[], rows: string[][], fmt: ExportFormat): string {
  if (fmt === 'csv') return toCsv(columns, rows);
  if (fmt === 'json') return JSON.stringify(objects(columns, rows), null, 2) + '\n';
  return objects(columns, rows).map((o) => JSON.stringify(o)).join('\n') + '\n';
}

export function safeName(name: string | undefined, fmt: ExportFormat, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const base =
    (name ?? '')
      .replace(/\.(csv|json|ndjson)$/i, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[.-]+/, '')
      .slice(0, 80) || `extract-${stamp}`;
  return `${base}.${fmt}`;
}

/** Writes into exportDir(); never overwrites (adds -1, -2 …). Returns the absolute path. */
export function saveExport(
  columns: string[],
  rows: string[][],
  fmt: ExportFormat,
  filename?: string,
  dir = exportDir(),
): { path: string; bytes: number } {
  mkdirSync(dir, { recursive: true });
  const wanted = safeName(filename, fmt);
  const dot = wanted.lastIndexOf('.');
  const stem = wanted.slice(0, dot);
  const ext = wanted.slice(dot);
  let path = join(dir, wanted);
  for (let i = 1; existsSync(path); i++) path = join(dir, `${stem}-${i}${ext}`);
  const data = serialize(columns, rows, fmt);
  writeFileSync(path, data, { encoding: 'utf8', flag: 'wx' });
  return { path, bytes: Buffer.byteLength(data) };
}
