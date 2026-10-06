import { pageText } from './text';
import { abs, clean, deepQueryAll, isHidden, refFor, resolveRef } from './util';

export interface NextTarget {
  kind: 'link' | 'click';
  href?: string;
  ref?: string;
  label: string;
  via: string;
}

const NEXT_TEXT = /^(next|next page|next ?[»›>→]|older|older posts|more|load more|show more|see more|view more|[›»>→]|>>)$/i;
const NEXT_ARIA = /\b(next|older)\b/i;
// Only matters for user-supplied selectors and as a backstop for heuristics: never click these.
const DENY = /\b(delete|remove|buy|pay|purchase|checkout|check out|place order|order now|confirm|submit|send|sign ?out|log ?out|unsubscribe|donate|reset|clear)\b/i;
const PAGER = 'nav[aria-label*="pag" i], [class*="pagination" i], [class*="pager" i], [role="navigation"]';

export function labelOf(el: Element): string {
  return clean(
    el.getAttribute('aria-label') || (el as HTMLInputElement).value || el.textContent || el.getAttribute('title') || '',
  );
}

export function isDenied(el: Element): boolean {
  return DENY.test(labelOf(el));
}

function isDisabled(el: Element): boolean {
  if (el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled')) return true;
  const cls = (e: Element | null) => /\b(disabled|inactive)\b/i.test(e?.getAttribute('class') ?? '');
  return cls(el) || cls(el.closest('li'));
}

const isSubmit = (el: Element) =>
  (el.tagName === 'BUTTON' && ((el as HTMLButtonElement).type || 'submit') === 'submit' && !!el.closest('form')) ||
  (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'submit');

function describe(el: Element, via: string): NextTarget {
  const doc = el.ownerDocument;
  const href = el.getAttribute('href');
  if (el.tagName === 'A' && href && !href.startsWith('#') && !/^javascript:/i.test(href)) {
    return { kind: 'link', href: abs(doc, href), label: labelOf(el), via };
  }
  return { kind: 'click', ref: refFor(el), label: labelOf(el), via };
}

/**
 * Find the control that advances to the next page / loads more.
 * With `selector`, uses exactly that (but refuses destructive-looking labels).
 * Otherwise: rel=next → "next"-like links/buttons (prefer pagination containers) → numbered pager.
 * Returns null when there is no (enabled) next control, i.e. the last page.
 */
export function findNext(doc: Document, opts: { selector?: string } = {}): NextTarget | null {
  if (opts.selector) {
    const el = deepQueryAll(doc, opts.selector).find((e) => !isHidden(e) && !isDisabled(e));
    if (!el) return null;
    if (isDenied(el)) throw new Error(`refusing to click "${labelOf(el).slice(0, 40)}": label looks destructive`);
    return describe(el, 'selector');
  }

  const rel = doc.querySelector('a[rel~="next" i][href], link[rel~="next" i][href]');
  if (rel && !isDisabled(rel)) return { kind: 'link', href: abs(doc, rel.getAttribute('href')), label: 'rel=next', via: 'rel' };

  const clickable = deepQueryAll(doc, 'a[href], button, [role="button"], [role="link"], input[type="button"]').filter(
    (e) => !isHidden(e) && !isDisabled(e) && !isSubmit(e) && !isDenied(e),
  );
  const looksNext = (e: Element) => {
    const t = clean(e.textContent);
    const aria = e.getAttribute('aria-label') ?? '';
    return NEXT_TEXT.test(t) || NEXT_TEXT.test(aria.trim()) || (aria !== '' && NEXT_ARIA.test(aria)) || e.getAttribute('rel') === 'next';
  };
  const matches = clickable.filter(looksNext);
  const inPager = matches.find((e) => e.closest(PAGER));
  const pick = inPager ?? matches[0];
  if (pick) return describe(pick, inPager ? 'pager' : 'text');

  // Numbered pager: the link after the current page.
  for (const pager of deepQueryAll(doc, PAGER)) {
    const cur = pager.querySelector('[aria-current="page"], .active, .current, .selected');
    if (!cur) continue;
    const item = cur.closest('li') ?? cur;
    let sib = item.nextElementSibling;
    while (sib) {
      const a = sib.matches('a[href]') ? sib : sib.querySelector('a[href]');
      if (a && !isDisabled(a) && !isHidden(a) && /^\d+$/.test(clean(a.textContent))) return describe(a, 'numbered');
      sib = sib.nextElementSibling;
    }
  }
  return null;
}

/** Cheap fingerprint of what the page currently shows; changes when content is replaced or appended. */
export function contentSig(doc: Document): string {
  const text = pageText(doc, { maxChars: 800 }).text;
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${doc.getElementsByTagName('*').length}|${h}`;
}

/** Resolve once the DOM has been quiet for quietMs (or after timeoutMs). */
export async function waitStable(doc: Document, opts: { quietMs?: number; timeoutMs?: number } = {}) {
  const quietMs = opts.quietMs ?? 400;
  const timeoutMs = opts.timeoutMs ?? 6000;
  const win = doc.defaultView!;
  const t0 = Date.now();
  if (doc.readyState !== 'complete') {
    await new Promise<void>((r) => {
      win.addEventListener('load', () => r(), { once: true });
      setTimeout(r, timeoutMs);
    });
  }
  return new Promise<{ settled: boolean; waitedMs: number }>((resolve) => {
    let quiet: ReturnType<typeof setTimeout>;
    const finish = (settled: boolean) => {
      obs.disconnect();
      clearTimeout(quiet);
      clearTimeout(cap);
      resolve({ settled, waitedMs: Date.now() - t0 });
    };
    const obs = new MutationObserver(() => {
      clearTimeout(quiet);
      quiet = setTimeout(() => finish(true), quietMs);
    });
    obs.observe(doc.documentElement, { subtree: true, childList: true, characterData: true });
    const cap = setTimeout(() => finish(false), Math.max(0, timeoutMs - (Date.now() - t0)));
    quiet = setTimeout(() => finish(true), quietMs);
  });
}

/** Poll until the content fingerprint differs from `before`. */
export async function waitChange(doc: Document, opts: { before: string; timeoutMs?: number }) {
  const deadline = Date.now() + (opts.timeoutMs ?? 6000);
  while (Date.now() < deadline) {
    if (contentSig(doc) !== opts.before) return { changed: true };
    await new Promise((r) => setTimeout(r, 200));
  }
  return { changed: false };
}

export function clickRef(doc: Document, ref: string) {
  const el = resolveRef(ref) as HTMLElement | null;
  if (!el) throw new Error(`ref ${ref} is stale`);
  if (isDenied(el)) throw new Error(`refusing to click "${labelOf(el).slice(0, 40)}": label looks destructive`);
  el.scrollIntoView?.({ block: 'center' });
  el.click();
  return { clicked: labelOf(el).slice(0, 40) };
}
