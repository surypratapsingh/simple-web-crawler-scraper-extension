import { DETAIL_AUTO_COLUMNS } from './crawl-util';
import { pageText } from './text';
import { abs, clean, clip, deepQueryAll } from './util';

// In-page extraction for a detail page (one item per page, as opposed to a repeating list).

export interface DetailField {
  selector?: string;
  attr?: string;
  /** Join the text of every match with " | " instead of taking only the first. */
  join?: boolean;
}

export interface DetailResult {
  columns: string[];
  cells: string[];
}

const CELL = 500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function ldNodes(doc: Document): Json[] {
  const out: Json[] = [];
  const walk = (x: Json) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      out.push(x);
      if (x['@graph']) walk(x['@graph']);
    }
  };
  for (const s of deepQueryAll(doc, 'script[type="application/ld+json"]')) {
    try {
      walk(JSON.parse(s.textContent ?? ''));
    } catch {
      /* malformed JSON-LD is common; ignore it */
    }
  }
  return out;
}

const types = (n: Json): string[] => ([] as unknown[]).concat(n?.['@type'] ?? []).map(String);
const str = (v: Json): string =>
  v == null ? '' : typeof v === 'object' ? String(Array.isArray(v) ? (v[0]?.name ?? v[0] ?? '') : (v.name ?? v['@value'] ?? '')) : String(v);

/** Product / article facts from schema.org JSON-LD (flat, best effort). */
export function jsonLd(doc: Document) {
  const ns = ldNodes(doc);
  const prod = ns.find((n) => types(n).some((t) => /^(Product|ProductGroup)$/i.test(t)));
  const art = ns.find((n) => types(n).some((t) => /(Article|BlogPosting|Event|Recipe|JobPosting|VideoObject)$/i.test(t)));
  const rawOffer = prod?.offers ?? ns.find((n) => types(n).includes('Offer'));
  const offer: Json = Array.isArray(rawOffer) ? rawOffer[0] : rawOffer;
  return {
    title: str(prod?.name ?? art?.headline ?? art?.name),
    price: str(offer?.price ?? offer?.lowPrice),
    currency: str(offer?.priceCurrency),
    sku: str(prod?.sku ?? prod?.mpn),
    availability: str(offer?.availability).replace(/^.*[/#]/, ''),
    date: str(art?.datePublished ?? art?.startDate ?? art?.datePosted),
  };
}

function detailAuto(doc: Document, textChars: number): DetailResult {
  const ld = jsonLd(doc);
  const meta = (n: string) => doc.querySelector(`meta[name="${n}"], meta[property="${n}"]`)?.getAttribute('content') ?? '';
  const one = (s: string) => clip(clean(s), CELL).text;
  const text = pageText(doc, { maxChars: textChars }).text.replace(/\s*\n\s*/g, ' ');
  const values: Record<(typeof DETAIL_AUTO_COLUMNS)[number], string> = {
    d_title: one(ld.title || doc.querySelector('h1')?.textContent || doc.title),
    d_description: one(meta('description') || meta('og:description')),
    d_price: one(ld.price),
    d_currency: one(ld.currency),
    d_sku: one(ld.sku),
    d_availability: one(ld.availability),
    d_date: one(ld.date || meta('article:published_time') || doc.querySelector('time[datetime]')?.getAttribute('datetime') || ''),
    d_text: clean(text).slice(0, textChars),
  };
  return { columns: [...DETAIL_AUTO_COLUMNS], cells: DETAIL_AUTO_COLUMNS.map((c) => values[c]) };
}

function detailByFields(doc: Document, fields: Record<string, DetailField> | Array<[string, DetailField]>): DetailResult {
  const entries = Array.isArray(fields) ? fields : Object.entries(fields);
  const columns = entries.map(([n]) => n);
  const cells = entries.map(([, f]) => {
    const els = f.selector ? deepQueryAll(doc, f.selector) : [doc.documentElement];
    if (!els.length) return '';
    const read = (el: Element) => {
      if (!f.attr) return clean(el.textContent);
      const v = el.getAttribute(f.attr) ?? '';
      return f.attr === 'href' || f.attr === 'src' ? abs(doc, v) : clean(v);
    };
    const v = f.join ? els.map(read).filter(Boolean).join(' | ') : read(els[0]);
    return clip(v, CELL).text;
  });
  return { columns, cells };
}

/** Extract one item's fields: explicit selectors if given, otherwise JSON-LD/meta/text. */
export function detailExtract(
  doc: Document,
  opts: { fields?: Record<string, DetailField> | Array<[string, DetailField]>; textChars?: number } = {},
): DetailResult {
  const n = Array.isArray(opts.fields) ? opts.fields.length : Object.keys(opts.fields ?? {}).length;
  if (opts.fields && n) return detailByFields(doc, opts.fields);
  return detailAuto(doc, Math.min(Math.max(opts.textChars ?? 400, 50), 2000));
}
