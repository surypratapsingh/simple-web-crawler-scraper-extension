import { abs, clean, deepQueryAll } from './util';
import { pageText } from './text';

// Email / phone / social-link scanning for a single page. Used standalone (page_contacts) and
// per-page inside a batch job (find_contacts with maxPages > 1).

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Loose but bounded: 7-15 digits with optional separators/parens/leading +. isPhoneLike() below
// filters out bare digit runs and ISO-date-shaped matches (e.g. 2026-09-21) that this also matches.
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,4}/g;
const DATE_LIKE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/;
const OBFUSCATED_AT = /\s*\(?at\)?\s*|\s*\[at\]\s*/gi;
const OBFUSCATED_DOT = /\s*\(?dot\)?\s*|\s*\[dot\]\s*/gi;

const SOCIAL_DOMAINS: Array<[platform: string, re: RegExp]> = [
  ['x', /(?:^|\.)(?:x\.com|twitter\.com)$/i],
  ['instagram', /(?:^|\.)instagram\.com$/i],
  ['facebook', /(?:^|\.)facebook\.com$/i],
  ['linkedin', /(?:^|\.)linkedin\.com$/i],
  ['youtube', /(?:^|\.)(?:youtube\.com|youtu\.be)$/i],
  ['tiktok', /(?:^|\.)tiktok\.com$/i],
  ['pinterest', /(?:^|\.)pinterest\.[a-z.]+$/i],
  ['github', /(?:^|\.)github\.com$/i],
  ['reddit', /(?:^|\.)reddit\.com$/i],
  ['telegram', /(?:^|\.)t\.me$/i],
  ['whatsapp', /(?:^|\.)wa\.me$/i],
  ['discord', /(?:^|\.)discord\.(?:gg|com)$/i],
];
// Paths that are the platform's own generic pages, not a profile/handle.
const SOCIAL_GENERIC_PATH = /^\/(?:share|sharer|intent|login|signup|home|explore|about|watch|embed|hashtag|search)(?:\/|$)/i;

function isPhoneLike(s: string): boolean {
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  if (!/[\s.()-]/.test(s) && !s.startsWith('+')) return false; // bare digit runs are usually ids, not phones
  if (DATE_LIKE.test(s)) return false;
  return true;
}

export interface ContactsResult {
  emails: string[];
  phones: string[];
  social: Array<{ platform: string; url: string }>;
}

export function scanContacts(doc: Document): ContactsResult {
  const emails = new Set<string>();
  for (const a of deepQueryAll(doc, 'a[href^="mailto:"]')) {
    const addr = (a.getAttribute('href') ?? '').slice(7).split('?')[0].trim();
    if (addr) emails.add(addr.toLowerCase());
  }
  const bodyText = pageText(doc, { maxChars: 50_000, selector: 'body' }).text;
  for (const m of bodyText.match(EMAIL_RE) ?? []) emails.add(m.toLowerCase());
  // A light pass for "name (at) domain (dot) com" obfuscation, only on short lines to limit false positives.
  for (const line of bodyText.split('\n')) {
    if (line.length > 200 || !/\(at\)|\[at\]/i.test(line)) continue;
    const de = line.replace(OBFUSCATED_AT, '@').replace(OBFUSCATED_DOT, '.');
    for (const m of de.match(EMAIL_RE) ?? []) emails.add(m.toLowerCase());
  }

  const phones = new Set<string>();
  for (const a of deepQueryAll(doc, 'a[href^="tel:"]')) {
    const num = (a.getAttribute('href') ?? '').slice(4).trim();
    if (num) phones.add(num);
  }
  for (const m of bodyText.match(PHONE_RE) ?? []) {
    const t = m.trim();
    if (isPhoneLike(t)) phones.add(t);
  }

  const social = new Map<string, string>();
  for (const a of deepQueryAll(doc, 'a[href]')) {
    const href = abs(doc, a.getAttribute('href'));
    let u: URL;
    try {
      u = new URL(href);
    } catch {
      continue;
    }
    const hit = SOCIAL_DOMAINS.find(([, re]) => re.test(u.hostname));
    if (!hit) continue;
    if (SOCIAL_GENERIC_PATH.test(u.pathname) || u.pathname === '/' || u.pathname === '') continue;
    const key = hit[0] + ':' + u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '').toLowerCase();
    if (!social.has(key)) social.set(key, href);
  }

  return {
    emails: [...emails].sort(),
    phones: [...phones].sort(),
    social: [...social.entries()].map(([key, url]) => ({ platform: key.slice(0, key.indexOf(':')), url })),
  };
}

export interface ImageInfo {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/** Every reasonably-sized image on the page (data: URIs and 1x1 pixels excluded), de-duplicated by src. */
export function listImages(doc: Document, opts: { minSize?: number } = {}): ImageInfo[] {
  const minSize = opts.minSize ?? 32;
  const seen = new Set<string>();
  const out: ImageInfo[] = [];
  for (const img of deepQueryAll(doc, 'img') as HTMLImageElement[]) {
    const raw = img.getAttribute('src') || img.getAttribute('data-src') || img.currentSrc || '';
    if (!raw || raw.startsWith('data:')) continue;
    const src = abs(doc, raw);
    if (seen.has(src)) continue;
    const w = img.naturalWidth || Number(img.getAttribute('width')) || 0;
    const h = img.naturalHeight || Number(img.getAttribute('height')) || 0;
    if ((w || h) && (w < minSize || h < minSize)) continue; // skip obvious icons/spacers/pixels
    seen.add(src);
    out.push({ src, alt: clean(img.getAttribute('alt')), width: w, height: h });
  }
  return out;
}
