import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { safeName, saveExport, serialize, toCsv } from './export';

const dir = mkdtempSync(join(tmpdir(), 'scrapeline-export-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('export', () => {
  it('quotes CSV cells and starts with a BOM', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['line\nbreak', 'ok']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"x,y","say ""hi"""');
    expect(csv).toContain('"line\nbreak",ok');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('neutralises spreadsheet formula injection but keeps real numbers', () => {
    const csv = toCsv(['v'], [['=HYPERLINK("http://evil")'], ['@SUM(A1)'], ['+cmd|x'], ['-5'], ['+1 555'], ['-2.5']]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).toContain("'+cmd|x");
    expect(csv).toMatch(/\r\n-5\r\n/);
    expect(csv).toMatch(/\r\n\+1 555\r\n/);
    expect(csv).toMatch(/\r\n-2\.5\r\n/);
  });

  it('serialises json and ndjson as objects', () => {
    expect(JSON.parse(serialize(['a', 'b'], [['1', '2']], 'json'))).toEqual([{ a: '1', b: '2' }]);
    expect(serialize(['a'], [['1'], ['2']], 'ndjson')).toBe('{"a":"1"}\n{"a":"2"}\n');
  });

  it('confines file names: no directories, traversal, or hidden files', () => {
    expect(safeName('../../etc/passwd', 'csv')).toBe('etc-passwd.csv');
    expect(safeName('C:\\Windows\\evil.csv', 'csv')).toBe('C-Windows-evil.csv');
    expect(safeName('.bashrc', 'json')).toBe('bashrc.json');
    expect(safeName('report.csv', 'csv')).toBe('report.csv');
    expect(safeName(undefined, 'ndjson', new Date('2026-09-21T10:20:30Z'))).toBe('extract-20260921-102030.ndjson');
    expect(safeName('a'.repeat(300), 'csv').length).toBeLessThanOrEqual(84);
  });

  it('writes under the export dir and never overwrites', () => {
    const a = saveExport(['n'], [['1']], 'csv', 'same', dir);
    const b = saveExport(['n'], [['2']], 'csv', 'same', dir);
    expect(a.path).toBe(join(dir, 'same.csv'));
    expect(b.path).toBe(join(dir, 'same-1.csv'));
    expect(readFileSync(a.path, 'utf8')).toContain('1');
    expect(readFileSync(b.path, 'utf8')).toContain('2');
    const evil = saveExport(['n'], [['3']], 'json', '../../outside', dir);
    expect(evil.path.startsWith(dir)).toBe(true);
  });
});
