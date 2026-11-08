// FIX 60ea5d9: the site folder must keep its secret-file ignore rule.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

describe('site/', () => {
  it('ignores .env* files so keys are never committed', () => {
    expect(read('./.gitignore').split(/\r?\n/)).toContain('.env*');
  });
});

// FIX de2c9e3: the landing page must keep its doctype, lang, charset and viewport meta.
describe('site/index.html', () => {
  const html = read('./index.html');
  it('keeps the viewport meta so phones scale the page', () => {
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1">/);
  });
  it('keeps doctype, lang and charset', () => {
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toMatch(/<meta charset="utf-8">/);
  });
});
