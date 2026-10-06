import {
  abs,
  allElements,
  childrenOf,
  clean,
  cssPath,
  deepQueryAll,
  deepQueryFirst,
  isHidden,
  isSkipped,
  stableClasses,
} from './util';

export interface Extracted {
  kind: 'table' | 'list';
  /** Selector matching every row (reusable with page_extract mode=fields). */
  rowSelector: string;
  columns: string[];
  rows: string[][];
  total: number;
  score: number;
}

export interface CandidateSummary {
  kind: 'table' | 'list';
  rowSelector: string;
  rows: number;
  columns: string[];
  score: number;
}

export interface DetectResult {
  best: Extracted | null;
  candidates: CandidateSummary[];
}

const MAX_CELL = 300;
const NAV_ANCESTORS = 'nav, header, footer, [role="navigation"], [role="banner"], [aria-hidden="true"]';
const TABLE_PARTS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'COLGROUP']);

function cell(s: string): string {
  const t = clean(s);
  return t.length > MAX_CELL ? t.slice(0, MAX_CELL - 1) + '…' : t;
}

// ---------------------------------------------------------------- tables

function extractTable(table: HTMLTableElement): Extracted | null {
  if (isHidden(table)) return null;
  const allRows = Array.from(table.rows);
  if (allRows.length < 3) return null;
  const first = allRows[0];
  const hasHeader = first.querySelector('th') !== null;
  const headers = hasHeader ? Array.from(first.cells).map((c) => cell(c.textContent ?? '')) : [];
  const bodyRows = (hasHeader ? allRows.slice(1) : allRows).filter((r) => r.cells.length > 0);
  const ncols = Math.max(...bodyRows.map((r) => r.cells.length), 0);
  if (bodyRows.length < 2 || ncols < 2) return null;
  const columns = Array.from({ length: ncols }, (_, i) => headers[i] || `col${i + 1}`);
  const rows = bodyRows.map((r) => Array.from({ length: ncols }, (_, i) => cell(r.cells[i]?.textContent ?? '')));
  const sel = cssPath(table);
  return {
    kind: 'table',
    rowSelector: `${sel} tr`,
    columns,
    rows,
    total: rows.length,
    score: rows.length * ncols * 2,
  };
}

// ----------------------------------------------------------------- lists

function signature(el: Element): string {
  return el.tagName.toLowerCase() + stableClasses(el, 4).sort().map((c) => '.' + c).join('');
}

interface Leaf {
  path: string;
  name: string;
  text: string;
  href?: string;
  src?: string;
}

function leafName(el: Element): string {
  const c = stableClasses(el, 1)[0];
  if (c) return c.toLowerCase();
  const tag = el.tagName.toLowerCase();
  return tag === 'a' ? 'link' : tag === 'img' ? 'image' : tag;
}

function leaves(row: Element): Leaf[] {
  const doc = row.ownerDocument;
  const out: Leaf[] = [];
  const walk = (el: Element, path: string, inLink: boolean) => {
    if (isSkipped(el)) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      const src = el.getAttribute('src') || el.getAttribute('data-src') || '';
      if (src) out.push({ path, name: leafName(el), text: '', src: abs(doc, src) });
      return;
    }
    let linkHere = inLink;
    if (tag === 'a' && el.hasAttribute('href') && !inLink) {
      const text = clean(el.textContent);
      out.push({ path, name: leafName(el), text, href: abs(doc, el.getAttribute('href')) });
      linkHere = true;
    }
    if (!linkHere) {
      const own = clean(
        Array.from(el.childNodes)
          .filter((n) => n.nodeType === 3)
          .map((n) => n.nodeValue ?? '')
          .join(' '),
      );
      if (own) out.push({ path, name: leafName(el), text: own });
    }
    const seen = new Map<string, number>();
    for (const child of childrenOf(el)) {
      const t = child.tagName.toLowerCase();
      const i = (seen.get(t) ?? 0) + 1;
      seen.set(t, i);
      walk(child, `${path}>${t}:${i}`, linkHere);
    }
  };
  walk(row, '', false);
  return out;
}

function extractList(parent: Element, rowEls: Element[]): Extracted | null {
  const perRow = rowEls.map((r) => leaves(r));
  const stats = new Map<string, { count: number; order: number; sample: Leaf }>();
  let order = 0;
  for (const ls of perRow) {
    const seenInRow = new Set<string>();
    for (const l of ls) {
      if (seenInRow.has(l.path)) continue;
      seenInRow.add(l.path);
      const s = stats.get(l.path);
      if (s) s.count++;
      else stats.set(l.path, { count: 1, order: order++, sample: l });
    }
  }
  const need = Math.max(2, Math.ceil(rowEls.length * 0.5));
  const kept = Array.from(stats.entries())
    .filter(([, s]) => s.count >= need)
    .sort((a, b) => a[1].order - b[1].order);
  if (kept.length === 0) return null;

  const used = new Map<string, number>();
  const uniq = (n: string) => {
    const k = (used.get(n) ?? 0) + 1;
    used.set(n, k);
    return k === 1 ? n : `${n}_${k}`;
  };
  const columns: string[] = [];
  const getters: Array<(m: Map<string, Leaf>) => string> = [];
  for (const [path, s] of kept) {
    const base = s.sample.name;
    if (s.sample.src !== undefined) {
      columns.push(uniq(base + '_src'));
      getters.push((m) => m.get(path)?.src ?? '');
    } else if (s.sample.href !== undefined) {
      columns.push(uniq(base));
      getters.push((m) => cell(m.get(path)?.text ?? ''));
      columns.push(uniq(base + '_url'));
      getters.push((m) => m.get(path)?.href ?? '');
    } else {
      columns.push(uniq(base));
      getters.push((m) => cell(m.get(path)?.text ?? ''));
    }
  }
  if (columns.length < 2) return null;
  const rows = perRow.map((ls) => {
    const m = new Map<string, Leaf>();
    for (const l of ls) if (!m.has(l.path)) m.set(l.path, l);
    return getters.map((g) => g(m));
  });
  const avgLen = rows.reduce((n, r) => n + r.join('').length, 0) / rows.length;
  if (avgLen < 4) return null; // icon-only / empty rows; short but real rows like "Lamp | $20" are fine
  const rowSelector = `${cssPath(parent)} > ${signature(rowEls[0])}`;
  return {
    kind: 'list',
    rowSelector,
    columns,
    rows,
    total: rows.length,
    score: rows.length * Math.min(columns.length, 8),
  };
}

/** `prefer`: only accept the candidate with this rowSelector (crawls keep the page-1 structure). */
export function detect(doc: Document, opts: { limit?: number; prefer?: string } = {}): DetectResult {
  const limit = opts.limit ?? 50;
  const found: Extracted[] = [];

  for (const t of deepQueryAll(doc, 'table')) {
    if (t.closest(NAV_ANCESTORS)) continue;
    const e = extractTable(t as HTMLTableElement);
    if (e) found.push(e);
  }

  for (const parent of allElements(doc.body)) {
    if (isSkipped(parent) || TABLE_PARTS.has(parent.tagName.toUpperCase())) continue;
    const kids = childrenOf(parent).filter((k) => !isSkipped(k));
    if (kids.length < 3) continue;
    const groups = new Map<string, Element[]>();
    for (const k of kids) {
      const s = signature(k);
      const g = groups.get(s);
      if (g) g.push(k);
      else groups.set(s, [k]);
    }
    let group: Element[] = [];
    for (const g of groups.values()) if (g.length > group.length) group = g;
    if (group.length < 3 || group.length < kids.length * 0.5) continue;
    if (parent.closest(NAV_ANCESTORS)) continue;
    if (isHidden(parent)) continue;
    const e = extractList(parent, group.filter((r) => !isHidden(r)));
    if (e && e.rows.length >= 3) found.push(e);
  }

  found.sort((a, b) => b.score - a.score);
  const best = opts.prefer ? (found.find((f) => f.rowSelector === opts.prefer) ?? null) : (found[0] ?? null);
  return {
    best: best ? { ...best, rows: best.rows.slice(0, limit) } : null,
    candidates: found.slice(0, 5).map((f) => ({
      kind: f.kind,
      rowSelector: f.rowSelector,
      rows: f.total,
      columns: f.columns,
      score: f.score,
    })),
  };
}

/** Extract by explicit selectors: rowSelector + per-field selector/attr. */
export function extractFields(
  doc: Document,
  opts: {
    rowSelector: string;
    fields: Record<string, { selector?: string; attr?: string }> | Array<[string, { selector?: string; attr?: string }]>;
    limit?: number;
  },
): Extracted {
  const rowEls = deepQueryAll(doc, opts.rowSelector);
  const entries = Array.isArray(opts.fields) ? opts.fields : Object.entries(opts.fields);
  const names = entries.map(([n]) => n);
  const rows = rowEls.slice(0, opts.limit ?? 50).map((row) =>
    entries.map(([, f]) => {
      const el = f.selector ? deepQueryFirst(row, f.selector) : row;
      if (!el) return '';
      if (f.attr) {
        const v = el.getAttribute(f.attr) ?? '';
        return f.attr === 'href' || f.attr === 'src' ? abs(doc, v) : cell(v);
      }
      return cell(el.textContent);
    }),
  );
  return { kind: 'list', rowSelector: opts.rowSelector, columns: names, rows, total: rowEls.length, score: 0 };
}
