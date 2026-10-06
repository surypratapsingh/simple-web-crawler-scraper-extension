import { describe, expect, it, vi } from 'vitest';
import { readSitemap, sitemapsFromRobots, type Fetcher } from './sitemap';

const res = (body: string, ok = true, status = 200) => ({ ok, status, text: async () => body });

describe('sitemapsFromRobots', () => {
  it('extracts Sitemap: lines case-insensitively', async () => {
    const fetcher: Fetcher = async () => res('User-agent: *\nDisallow: /admin\nSitemap: https://x.com/sitemap.xml\nsitemap: https://x.com/sitemap2.xml\n');
    expect(await sitemapsFromRobots('https://x.com', fetcher)).toEqual(['https://x.com/sitemap.xml', 'https://x.com/sitemap2.xml']);
  });

  it('returns nothing when robots.txt is missing', async () => {
    const fetcher: Fetcher = async () => res('', false, 404);
    expect(await sitemapsFromRobots('https://x.com', fetcher)).toEqual([]);
  });
});

describe('readSitemap', () => {
  it('reads a plain urlset and decodes entities', async () => {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://x.com/a?x=1&amp;y=2</loc></url><url><loc>https://x.com/b</loc></url></urlset>`;
    const fetcher: Fetcher = async () => res(xml);
    const r = await readSitemap('https://x.com/sitemap.xml', { fetcher });
    expect(r.urls).toEqual(['https://x.com/a?x=1&y=2', 'https://x.com/b']);
    expect(r.sitemapsRead).toBe(1);
    expect(r.truncated).toBe(false);
  });

  it('follows a sitemap index into its child sitemaps', async () => {
    const index = `<sitemapindex><sitemap><loc>https://x.com/s1.xml</loc></sitemap><sitemap><loc>https://x.com/s2.xml</loc></sitemap></sitemapindex>`;
    const s1 = `<urlset><url><loc>https://x.com/a</loc></url></urlset>`;
    const s2 = `<urlset><url><loc>https://x.com/b</loc></url></urlset>`;
    const fetcher: Fetcher = vi.fn(async (u: string) => res(u.endsWith('s1.xml') ? s1 : u.endsWith('s2.xml') ? s2 : index));
    const r = await readSitemap('https://x.com/sitemap.xml', { fetcher });
    expect(r.urls.sort()).toEqual(['https://x.com/a', 'https://x.com/b']);
    expect(r.sitemapsRead).toBe(3);
  });

  it('checks robots.txt for a Sitemap: line when given a bare origin', async () => {
    const fetcher: Fetcher = vi.fn(async (u: string) => {
      if (u.endsWith('robots.txt')) return res('Sitemap: https://x.com/custom-sitemap.xml\n');
      if (u.endsWith('custom-sitemap.xml')) return res('<urlset><url><loc>https://x.com/only</loc></url></urlset>');
      return res('<urlset></urlset>'); // the guessed /sitemap.xml, empty
    });
    const r = await readSitemap('https://x.com/', { fetcher });
    expect(r.urls).toEqual(['https://x.com/only']);
  });

  it('applies a substring filter and reports truncation at maxUrls', async () => {
    const xml = `<urlset>${Array.from({ length: 5 }, (_, i) => `<url><loc>https://x.com/${i % 2 === 0 ? 'blog' : 'shop'}/${i}</loc></url>`).join('')}</urlset>`;
    const fetcher: Fetcher = async () => res(xml);
    const filtered = await readSitemap('https://x.com/sitemap.xml', { fetcher, filter: 'blog' });
    expect(filtered.urls).toHaveLength(3);
    expect(filtered.urls.every((u) => u.includes('blog'))).toBe(true);

    const capped = await readSitemap('https://x.com/sitemap.xml', { fetcher, maxUrls: 2 });
    expect(capped.urls).toHaveLength(2);
    expect(capped.truncated).toBe(true);
  });

  it('records fetch errors without throwing and continues with the rest of the queue', async () => {
    const index = `<sitemapindex><sitemap><loc>https://x.com/bad.xml</loc></sitemap><sitemap><loc>https://x.com/ok.xml</loc></sitemap></sitemapindex>`;
    const fetcher: Fetcher = async (u: string) => {
      if (u.endsWith('bad.xml')) return res('', false, 500);
      if (u.endsWith('ok.xml')) return res('<urlset><url><loc>https://x.com/fine</loc></url></urlset>');
      return res(index);
    };
    const r = await readSitemap('https://x.com/sitemap.xml', { fetcher });
    expect(r.urls).toEqual(['https://x.com/fine']);
    expect(r.errors).toEqual(['https://x.com/bad.xml: HTTP 500']);
  });
});
