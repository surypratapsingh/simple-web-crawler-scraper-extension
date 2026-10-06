import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// "Save any setup and run it again" — a named recipe is just {tool, args} for one of this
// server's own tools, saved as JSON so it survives restarts and can be handed to a colleague.

export function recipesDir(): string {
  return process.env.SCRAPELINE_RECIPES_DIR || join(homedir(), '.scrapeline', 'recipes');
}

export interface Recipe {
  name: string;
  tool: string;
  args: Record<string, unknown>;
  savedAt: string;
}

/** Same name -> same file, no directories, no traversal, no hidden files. */
export function safeRecipeName(name: string): string {
  const base = name
    .trim()
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 60);
  if (!base) throw new Error('recipe name is empty after sanitizing');
  return base;
}

function pathFor(name: string, dir = recipesDir()): string {
  return join(dir, safeRecipeName(name) + '.json');
}

export function saveRecipe(name: string, tool: string, args: Record<string, unknown>, dir = recipesDir()): Recipe {
  mkdirSync(dir, { recursive: true });
  const recipe: Recipe = { name: safeRecipeName(name), tool, args, savedAt: new Date().toISOString() };
  writeFileSync(pathFor(name, dir), JSON.stringify(recipe, null, 2) + '\n', 'utf8');
  return recipe;
}

export function loadRecipe(name: string, dir = recipesDir()): Recipe {
  const p = pathFor(name, dir);
  if (!existsSync(p)) throw new Error(`no recipe named "${name}" in ${dir}`);
  return JSON.parse(readFileSync(p, 'utf8')) as Recipe;
}

export function deleteRecipe(name: string, dir = recipesDir()): boolean {
  const p = pathFor(name, dir);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

export function listRecipes(dir = recipesDir()): Recipe[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Recipe)
    .sort((a, b) => a.name.localeCompare(b.name));
}
