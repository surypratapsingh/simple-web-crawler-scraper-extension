import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteRecipe, listRecipes, loadRecipe, safeRecipeName, saveRecipe } from './recipes';

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});
const tmp = () => (dir = mkdtempSync(join(tmpdir(), 'scrapeline-recipes-')));

describe('safeRecipeName', () => {
  it('strips traversal and directory separators', () => {
    expect(safeRecipeName('../../etc/passwd')).toBe('etc-passwd');
    expect(safeRecipeName('C:\\Windows\\evil')).toBe('C-Windows-evil');
  });

  it('rejects a name that sanitizes to nothing', () => {
    expect(() => safeRecipeName('///')).toThrow(/empty/);
  });
});

describe('recipes', () => {
  it('round-trips save/load, and overwrites on the same name', () => {
    tmp();
    saveRecipe('weekly shop scan', 'crawl_start', { url: 'https://x.com', maxPages: 5 }, dir);
    const r = loadRecipe('weekly shop scan', dir);
    expect(r).toMatchObject({ name: 'weekly shop scan', tool: 'crawl_start', args: { url: 'https://x.com', maxPages: 5 } });
    saveRecipe('weekly shop scan', 'crawl_start', { url: 'https://x.com', maxPages: 9 }, dir);
    expect(loadRecipe('weekly shop scan', dir).args.maxPages).toBe(9);
  });

  it('throws a clear error for a missing recipe', () => {
    tmp();
    expect(() => loadRecipe('nope', dir)).toThrow(/no recipe named/);
  });

  it('lists recipes sorted by name', () => {
    tmp();
    saveRecipe('zeta', 'crawl_start', {}, dir);
    saveRecipe('alpha', 'crawl_start', {}, dir);
    expect(listRecipes(dir).map((r) => r.name)).toEqual(['alpha', 'zeta']);
    expect(listRecipes(join(dir, 'missing'))).toEqual([]);
  });

  it('deletes a recipe and reports whether one existed', () => {
    tmp();
    saveRecipe('temp', 'crawl_start', {}, dir);
    expect(deleteRecipe('temp', dir)).toBe(true);
    expect(deleteRecipe('temp', dir)).toBe(false);
    expect(listRecipes(dir)).toEqual([]);
  });
});
