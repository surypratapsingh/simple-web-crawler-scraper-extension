// Pure-Node sitemap.xml reader ("Sitemap Explorer"). Sitemaps are public by definition (they exist
// so search engines can fetch them anonymously), so this talks to the site directly over fetch()
// rather than through the user's browser — no session, no login, nothing of the user's involved.

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const LOC_RE = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(LOC_RE)].map((m) => decode(m[1].trim()));
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

export interface SitemapResult {
  urls: string[];
  sitemapsRead: number;
  truncated: boolean;
  errors: string[];
}

/** robots.txt "Sitemap:" lines, if any (a common way to discover the real sitemap URL). */
export async function sitemapsFromRobots(origin: string, fetcher: Fetcher): Promise<string[]> {
  try {
    const r = await fetcher(`${origin}/robots.txt`);
    if (!r.ok) return [];
    const text = await r.text();
    return [...text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  } catch {
    return [];
  }
}

/**
 * Reads a sitemap (or sitemap index, recursively) and returns the page URLs it lists.
 * `startUrl` may be a sitemap.xml URL directly, or a bare site origin (robots.txt is checked first).
 */
export async function readSitemap(
  startUrl: string,
  opts: { maxUrls?: number; maxSitemaps?: number; filter?: string; fetcher?: Fetcher } = {},
): Promise<SitemapResult> {
  const fetcher: Fetcher = opts.fetcher ?? ((u) => fetch(u));
  const maxUrls = Math.min(opts.maxUrls ?? 2000, 20_000);
  const maxSitemaps = Math.min(opts.maxSitemaps ?? 20, 200);
  const filter = opts.filter?.toLowerCase();

  const start = new URL(startUrl);
  const seeds: string[] =
    start.pathname === '/' || start.pathname === ''
      ? (await sitemapsFromRobots(start.origin, fetcher)).concat(`${start.origin}/sitemap.xml`)
      : [start.href];

  const queue = [...new Set(seeds)];
  const urls = new Set<string>();
  const errors: string[] = [];
  let sitemapsRead = 0;
  let truncated = false;

  while (queue.length && sitemapsRead < maxSitemaps && urls.size < maxUrls) {
    const next = queue.shift()!;
    sitemapsRead++;
    let xml: string;
    try {
      const r = await fetcher(next);
      if (!r.ok) {
        errors.push(`${next}: HTTP ${r.status}`);
        continue;
      }
      xml = await r.text();
    } catch (e) {
      errors.push(`${next}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const locs = extractLocs(xml);
    if (isSitemapIndex(xml)) {
      queue.push(...locs);
      continue;
    }
    for (const loc of locs) {
      if (filter && !loc.toLowerCase().includes(filter)) continue;
      if (urls.size >= maxUrls) {
        truncated = true;
        break;
      }
      urls.add(loc);
    }
  }
  if (queue.length) truncated = true;

  return { urls: [...urls], sitemapsRead, truncated, errors };
}
