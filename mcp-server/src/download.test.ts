import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadImages, type Fetcher } from './download';

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});
const tmp = () => (dir = mkdtempSync(join(tmpdir(), 'scrapeline-dl-')));

function fakeFetch(bodies: Record<string, { status?: number; type?: string; body?: string }>): Fetcher {
  return (async (url: string) => {
    const b = bodies[url];
    if (!b) return { ok: false, status: 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
    const bytes = new TextEncoder().encode(b.body ?? 'fake-bytes');
    return {
      ok: (b.status ?? 200) < 400,
      status: b.status ?? 200,
      headers: new Headers(b.type ? { 'content-type': b.type } : {}),
      arrayBuffer: async () => bytes.buffer,
    } as unknown as Response;
  }) as Fetcher;
}

describe('downloadImages', () => {
  it('saves images named from the URL path and reports bytes', async () => {
    tmp();
    const fetcher = fakeFetch({ 'https://x.com/photos/cat.jpg': { type: 'image/jpeg', body: 'abc' } });
    const r = await downloadImages(['https://x.com/photos/cat.jpg'], { dir, folder: 'shop', fetcher });
    expect(r.saved).toHaveLength(1);
    expect(r.saved[0].path).toBe(join(dir, 'shop', 'cat.jpg'));
    expect(r.saved[0].bytes).toBe(3);
    expect(readFileSync(r.saved[0].path, 'utf8')).toBe('abc');
  });

  it('uses the path basename with the extension inferred from content-type when the URL itself has none', async () => {
    tmp();
    const fetcher = fakeFetch({ 'https://x.com/img?id=1': { type: 'image/webp' } });
    const r = await downloadImages(['https://x.com/img?id=1'], { dir, fetcher });
    expect(r.saved[0].path).toBe(join(dir, 'images', 'img.webp'));
  });

  it('falls back to an index-based name when the URL has no path at all', async () => {
    tmp();
    const fetcher = fakeFetch({ 'https://x.com/': { type: 'image/webp' } });
    const r = await downloadImages(['https://x.com/'], { dir, fetcher });
    expect(r.saved[0].path).toBe(join(dir, 'images', 'image-001.webp'));
  });

  it('honours an explicit name list', async () => {
    tmp();
    const fetcher = fakeFetch({ 'https://x.com/a.jpg': { type: 'image/jpeg' } });
    const r = await downloadImages(['https://x.com/a.jpg'], { dir, names: ['front-view.jpg'], fetcher });
    expect(r.saved[0].path).toBe(join(dir, 'images', 'front-view.jpg'));
  });

  it('never overwrites: a name collision gets a numeric suffix', async () => {
    tmp();
    const fetcher = fakeFetch({ 'https://x.com/a.jpg': { type: 'image/jpeg' }, 'https://x.com/b/a.jpg': { type: 'image/jpeg' } });
    const r = await downloadImages(['https://x.com/a.jpg', 'https://x.com/b/a.jpg'], { dir, fetcher });
    expect(r.saved.map((s) => s.path).sort()).toEqual([join(dir, 'images', 'a-1.jpg'), join(dir, 'images', 'a.jpg')].sort());
  });

  it('skips non-images, HTTP errors, empty bodies, and non-http schemes, without throwing', async () => {
    tmp();
    const fetcher = fakeFetch({
      'https://x.com/notreally.jpg': { type: 'text/html' },
      'https://x.com/missing.jpg': { status: 404 },
      'https://x.com/empty.jpg': { type: 'image/jpeg', body: '' },
    });
    const r = await downloadImages(['https://x.com/notreally.jpg', 'https://x.com/missing.jpg', 'https://x.com/empty.jpg', 'data:image/png;base64,xx'], { dir, fetcher });
    expect(r.saved).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual([
      'not an image (text/html)',
      'HTTP 404',
      'empty response',
      'unsupported scheme data:',
    ]);
  });

  it('skips files larger than maxBytes', async () => {
    tmp();
    const fetcher = fakeFetch({ 'https://x.com/big.jpg': { type: 'image/jpeg', body: 'x'.repeat(100) } });
    const r = await downloadImages(['https://x.com/big.jpg'], { dir, fetcher, maxBytes: 10 });
    expect(r.saved).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/too large/);
  });

  it('caps how many URLs are attempted via maxCount', async () => {
    tmp();
    const urls = Array.from({ length: 5 }, (_, i) => `https://x.com/${i}.jpg`);
    const fetcher = fakeFetch(Object.fromEntries(urls.map((u) => [u, { type: 'image/jpeg' }])));
    const r = await downloadImages(urls, { dir, fetcher, maxCount: 2 });
    expect(r.saved).toHaveLength(2);
  });
});
