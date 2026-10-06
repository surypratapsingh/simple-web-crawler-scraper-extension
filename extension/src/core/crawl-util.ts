// Pure helpers for the crawler (no DOM, no extension APIs) so they can be unit-tested in node.

export type StopReason =
  | 'done_no_next'
  | 'next_no_effect'
  | 'max_pages'
  | 'max_rows'
  | 'no_new_rows'
  | 'no_rows'
  | 'cancelled'
  | 'disabled'
  | 'blocked'
  | 'off_site'
  | 'tab_closed'
  | 'timeout'
  | 'max_details'
  | 'detail_errors'
  | 'error';

/** Stable identity of a row for de-duplication across pages. */
export function rowKey(row: string[]): string {
  return row.join('');
}

/** Re-order/pad a page's rows into the master column order (matching by column name). */
export function alignRows(cols: string[], master: string[], rows: string[][]): string[][] {
  if (cols.length === master.length && cols.every((c, i) => c === master[i])) return rows;
  const idx = master.map((m) => cols.indexOf(m));
  return rows.map((r) => idx.map((i) => (i >= 0 ? (r[i] ?? '') : '')));
}

export function buildUrl(template: string, n: number): string {
  return template.split('{n}').join(String(n));
}

/** Delay with up to +50% jitter so requests are not perfectly periodic. */
export function jitter(ms: number, rnd: () => number = Math.random): number {
  return Math.round(ms * (1 + rnd() * 0.5));
}

// ------------------------------------------------------------------ robots.txt

export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

/** Rules that apply to `agent` (falls back to the * group). Minimal RFC 9309 subset. */
export function parseRobots(text: string, agent = 'scrapeline'): RobotsRules {
  type Group = { agents: string[]; allow: string[]; disallow: string[] };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow' && val) cur.allow.push(val);
    else if (key === 'disallow' && val) cur.disallow.push(val);
  }
  const a = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((x) => x !== '*' && a.includes(x)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return { allow: chosen.flatMap((g) => g.allow), disallow: chosen.flatMap((g) => g.disallow) };
}

function ruleMatches(rule: string, path: string): number {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp('^' + body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (anchored ? '$' : ''));
  return re.test(path) ? body.length : -1;
}

/** Longest matching rule wins; Allow wins ties (per RFC 9309). */
export function robotsAllows(rules: RobotsRules, pathAndQuery: string): boolean {
  let best = -1;
  let allowed = true;
  for (const r of rules.disallow) {
    const n = ruleMatches(r, pathAndQuery);
    if (n > best) {
      best = n;
      allowed = false;
    }
  }
  for (const r of rules.allow) {
    const n = ruleMatches(r, pathAndQuery);
    if (n >= best && n >= 0) {
      best = n;
      allowed = true;
    }
  }
  return allowed;
}

// -------------------------------------------------------------- detail pages

/** Fixed column set for detail.mode=auto (JSON-LD / meta / text), in this order. */
export const DETAIL_AUTO_COLUMNS = [
  'd_title',
  'd_description',
  'd_price',
  'd_currency',
  'd_sku',
  'd_availability',
  'd_date',
  'd_text',
] as const;

/** Index of the column holding detail-page links: the named one, else the first *_url / link / href column. */
export function resolveLinkIndex(columns: string[], linkColumn?: string): number {
  if (linkColumn) return columns.indexOf(linkColumn);
  return columns.findIndex((c) => /(^|_)(url|link|href)$/i.test(c));
}

/** Same host, or one is a subdomain of the other. Detail links must stay on the list page's site. */
export function hostRelated(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.endsWith('.' + y) || y.endsWith('.' + x);
}

/** Make `wanted` names unique against `taken` (and each other) by suffixing _d, _d3, … */
export function uniqueNames(taken: string[], wanted: string[]): string[] {
  const used = new Set(taken);
  return wanted.map((w) => {
    let n = w;
    if (used.has(n)) n = `${w}_d`;
    for (let i = 3; used.has(n); i++) n = `${w}_d${i}`;
    used.add(n);
    return n;
  });
}

// ------------------------------------------------------- ordered field specs

export interface FieldSpec {
  selector?: string;
  attr?: string;
  join?: boolean;
}
export type FieldPairs = Array<[string, FieldSpec]>;

/**
 * Field specs as ordered [name, spec] pairs. Chrome's extension APIs (executeScript args, chrome.storage,
 * messaging) turn objects into sorted maps, silently losing key order, so anything whose column order matters
 * must travel as an array. Idempotent: pairs pass through unchanged.
 */
export function toPairs(f?: Record<string, FieldSpec> | FieldPairs | null): FieldPairs | undefined {
  if (!f) return undefined;
  return Array.isArray(f) ? f : Object.entries(f);
}
