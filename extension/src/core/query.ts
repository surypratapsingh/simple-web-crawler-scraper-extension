import { abs, clean, clip, deepQueryAll, refFor, resolveRef } from './util';

export function pageInfo(doc: Document) {
  const win = doc.defaultView;
  const q = (s: string) => doc.querySelectorAll(s).length;
  const meta = (n: string) =>
    doc.querySelector(`meta[name="${n}"], meta[property="${n}"]`)?.getAttribute('content') ?? '';
  return {
    title: clean(doc.title),
    url: doc.location?.href ?? '',
    lang: doc.documentElement.lang || '',
    description: clip(clean(meta('description') || meta('og:description')), 200).text,
    h1: clip(clean(doc.querySelector('h1')?.textContent), 120).text,
    readyState: doc.readyState,
    counts: {
      links: q('a[href]'),
      images: q('img'),
      forms: q('form'),
      tables: q('table'),
      buttons: q('button, [role="button"]'),
      inputs: q('input, select, textarea'),
    },
    textChars: clean(doc.body?.textContent).length,
    scroll: win
      ? { y: Math.round(win.scrollY), height: doc.documentElement.scrollHeight, viewport: win.innerHeight }
      : undefined,
  };
}

export interface QueryOpts {
  selector?: string;
  ref?: string;
  attrs?: string[];
  limit?: number;
  maxChars?: number;
}

export function pageQuery(doc: Document, opts: QueryOpts) {
  const limit = opts.limit ?? 20;
  const maxChars = opts.maxChars ?? 1500;
  let els: Element[];
  if (opts.ref) {
    const el = resolveRef(opts.ref);
    if (!el) throw new Error(`ref ${opts.ref} is stale or unknown (page changed?) — call page_outline again`);
    els = [el];
  } else if (opts.selector) {
    els = deepQueryAll(doc, opts.selector);
  } else {
    throw new Error('provide selector or ref');
  }
  const total = els.length;
  let used = 0;
  let truncated = total > limit;
  const items: Array<{ ref: string; tag: string; text: string; attrs?: Record<string, string> }> = [];
  for (const el of els.slice(0, limit)) {
    const text = clip(clean(el.textContent), 300).text;
    const attrs: Record<string, string> = {};
    for (const a of opts.attrs ?? []) {
      const v = el.getAttribute(a);
      if (v !== null) attrs[a] = a === 'href' || a === 'src' ? abs(doc, v) : v;
    }
    const item = {
      ref: refFor(el),
      tag: el.tagName.toLowerCase(),
      text,
      ...(Object.keys(attrs).length ? { attrs } : {}),
    };
    used += JSON.stringify(item).length;
    if (used > maxChars) {
      truncated = true;
      break;
    }
    items.push(item);
  }
  return { total, returned: items.length, truncated, items };
}

export async function pageScroll(
  doc: Document,
  opts: { direction?: 'down' | 'up' | 'top' | 'bottom'; amount?: number; waitMs?: number },
) {
  const win = doc.defaultView!;
  const dir = opts.direction ?? 'down';
  const step = opts.amount ?? Math.round(win.innerHeight * 0.9);
  if (dir === 'top') win.scrollTo(0, 0);
  else if (dir === 'bottom') win.scrollTo(0, doc.documentElement.scrollHeight);
  else win.scrollBy(0, dir === 'down' ? step : -step);
  await new Promise((r) => setTimeout(r, Math.min(opts.waitMs ?? 400, 3000)));
  const height = doc.documentElement.scrollHeight;
  const y = Math.round(win.scrollY);
  return { y, height, viewport: win.innerHeight, atBottom: y + win.innerHeight >= height - 2 };
}
