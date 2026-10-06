import { abs, deepQueryAll } from './util';

// Used by the batch engine's `discover` mode (follow internal links to find more pages),
// e.g. for a site-wide email/contact scan.

const SKIP_EXT = /\.(?:pdf|jpe?g|png|gif|svg|webp|css|js|json|xml|zip|rar|mp4|mp3|avi|mov|woff2?|ttf|ico|csv|xlsx?|docx?)(?:[?#]|$)/i;

/** Unique absolute http(s) page links on the page (mailto/tel/javascript/assets/fragments-only excluded). */
export function pageLinks(doc: Document): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of deepQueryAll(doc, 'a[href]')) {
    const raw = a.getAttribute('href') ?? '';
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript):/i.test(raw)) continue;
    const href = abs(doc, raw);
    let u: URL;
    try {
      u = new URL(href);
    } catch {
      continue;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    if (SKIP_EXT.test(u.pathname)) continue;
    const key = u.origin + u.pathname + u.search;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
