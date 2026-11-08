// FIX 60ea5d9: the site folder must keep its secret-file ignore rule.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

describe('site/', () => {
  it('ignores .env* files so keys are never committed', () => {
    expect(read('./.gitignore').split(/\r?\n/)).toContain('.env*');
  });
});
