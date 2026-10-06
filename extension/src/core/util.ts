// Pure DOM helpers shared by the injected-script modules. Everything here takes a
// Document/Element so it can be unit-tested under jsdom.

export const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'CANVAS',
  'IFRAME',
  'OBJECT',
  'HEAD',
  'META',
  'LINK',
]);

export function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

export function clip(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, Math.max(0, max - 1)) + '…', truncated: true };
}

export function isSkipped(el: Element): boolean {
  return SKIP_TAGS.has(el.tagName.toUpperCase());
}

export function isHidden(el: Element): boolean {
  if ((el as HTMLElement).hidden) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const view = el.ownerDocument.defaultView;
  const cs = view?.getComputedStyle(el);
  // display:contents has no box, so checkVisibility() reports false for it (e.g. <slot>,
  // layout wrappers) even though its children render. Not hidden.
  if (cs?.display === 'contents') return false;
  const cv = (el as unknown as { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (typeof cv === 'function') {
    try {
      return !cv.call(el, { checkVisibilityCSS: true });
    } catch {
      /* fall through */
    }
  }
  return !!cs && (cs.display === 'none' || cs.visibility === 'hidden');
}

// ---------- shadow DOM (open roots only) ----------

export type Scope = Document | Element | ShadowRoot;

/** Every element under root, descending into open shadow roots. */
export function allElements(root: Scope): Element[] {
  const out: Element[] = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    out.push(el);
    if (el.shadowRoot) out.push(...allElements(el.shadowRoot));
  }
  return out;
}

/** querySelectorAll that also searches open shadow roots. */
export function deepQueryAll(root: Scope, selector: string): Element[] {
  const out = Array.from(root.querySelectorAll(selector));
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.shadowRoot) out.push(...deepQueryAll(el.shadowRoot, selector));
  }
  return out;
}

export function deepQueryFirst(root: Scope, selector: string): Element | null {
  return root.querySelector(selector) ?? deepQueryAll(root, selector)[0] ?? null;
}

/** Element children as rendered: a shadow host shows its shadow tree, not its light children. */
export function childrenOf(el: Element): Element[] {
  return Array.from((el.shadowRoot ?? el).children);
}

export function abs(doc: Document, url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url, doc.baseURI).href;
  } catch {
    return url;
  }
}

/** Shorten same-origin URLs to path+query to save tokens. */
export function shortUrl(doc: Document, url: string | null | undefined): string {
  const full = abs(doc, url);
  try {
    const u = new URL(full);
    if (u.origin === new URL(doc.baseURI).origin) return u.pathname + u.search + u.hash;
  } catch {
    /* ignore */
  }
  return full;
}

// ---------- refs: short ids (e1, e2 …) that survive between tool calls ----------

// The background worker re-injects the script on every call, which re-evaluates this module.
// Keep the table on the (isolated-world) global so refs survive between calls.
interface RefState {
  refs: Map<string, Element>;
  rev: WeakMap<Element, string>;
  n: number;
}
const g = globalThis as unknown as { __scrapelineRefs?: RefState };
const state: RefState = (g.__scrapelineRefs ??= { refs: new Map(), rev: new WeakMap(), n: 0 });

export function refFor(el: Element): string {
  const existing = state.rev.get(el);
  if (existing) return existing;
  const id = 'e' + ++state.n;
  state.refs.set(id, el);
  state.rev.set(el, id);
  return id;
}

export function resolveRef(ref: string): Element | null {
  const el = state.refs.get(ref);
  return el && el.isConnected ? el : null;
}

// ---------- selector generation ----------

// Keep this regex ASCII-only in source: a literal U+FFFF in the bundle makes Chrome
// reject the injected script as "not UTF-8".
const esc = (s: string) =>
  s.replace(/^\d/, (d) => `\\3${d} `).replace(/[^\p{L}\p{N}_-]/gu, (c) => '\\' + c);

/** Reject classes that look generated (css-in-js hashes, css-modules, tailwind variants). */
export function stableClass(c: string): boolean {
  if (!c || c.length > 32) return false;
  if (/[:[\]/!@%]/.test(c)) return false;
  if (/\d{3,}/.test(c)) return false;
  if (/^(css|sc|jsx|emotion|svelte)-/i.test(c)) return false;
  if (/^_/.test(c)) return false;
  if (/__[A-Za-z0-9_-]{5,}$/.test(c)) return false;
  if (/^[a-z]{1,3}[A-Z0-9][A-Za-z0-9]{5,}$/.test(c)) return false;
  return true;
}

export function stableClasses(el: Element, max = 2): string[] {
  return Array.from(el.classList).filter(stableClass).slice(0, max);
}

/** Short, reasonably robust CSS selector for an element (unique in the document). */
export function cssPath(el: Element): string {
  const doc = el.ownerDocument;
  // Inside a shadow tree the path is relative to its shadow root; deepQueryAll resolves it.
  const scope = el.getRootNode() as Document | ShadowRoot;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur !== doc.documentElement) {
    const tag = cur.tagName.toLowerCase();
    if (cur.id && !/\d{3,}/.test(cur.id) && scope.querySelectorAll('#' + esc(cur.id)).length === 1) {
      parts.unshift('#' + esc(cur.id));
      break;
    }
    let part = tag + stableClasses(cur).map((c) => '.' + esc(c)).join('');
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((s) => s.matches(part));
      if (same.length > 1) {
        const idx = Array.from(parent.children).filter((s) => s.tagName === cur!.tagName).indexOf(cur) + 1;
        part = `${tag}:nth-of-type(${idx})`;
      }
    }
    parts.unshift(part);
    const candidate = parts.join(' > ');
    try {
      if (scope.querySelectorAll(candidate).length === 1) break;
    } catch {
      /* keep climbing */
    }
    cur = parent;
  }
  return parts.join(' > ');
}
