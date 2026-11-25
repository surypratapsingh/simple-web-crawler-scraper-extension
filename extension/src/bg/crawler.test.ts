// Runs createCrawler against a fake browser (storage, tabs) and a fake page runner,
// so pagination, stop reasons, de-duplication, robots and detail visits are tested without Chrome.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  const listeners = new Set<(id: number, info: { status?: string }) => void>();
  const tabs = new Map<number, { id: number; url: string; status: string }>();
  let nextId = 1;
  const fire = (id: number, status: string) => listeners.forEach((l) => l(id, { status }));
  const browser = {
    storage: {
      local: {
        get: async (k: string | string[]) => {
          const out: Record<string, unknown> = {};
          for (const key of Array.isArray(k) ? k : [k]) if (key in store) out[key] = structuredClone(store[key]);
          return out;
        },
        set: async (o: Record<string, unknown>) => { Object.assign(store, structuredClone(o)); },
        remove: async (k: string | string[]) => { for (const key of Array.isArray(k) ? k : [k]) delete store[key]; },
      },
    },
    tabs: {
      create: async ({ url }: { url: string }) => { const t = { id: nextId++, url, status: 'complete' }; tabs.set(t.id, t); return t; },
      get: async (id: number) => { const t = tabs.get(id); if (!t) throw new Error('No tab'); return { ...t }; },
      query: async () => [],
      update: async (id: number, { url }: { url: string }) => {
        const t = tabs.get(id)!;
        t.url = url;
        setTimeout(() => { fire(id, 'loading'); setTimeout(() => fire(id, 'complete'), 0); }, 0);
        return t;
      },
      remove: async (id: number) => { tabs.delete(id); },
      onUpdated: { addListener: (l: (id: number, info: { status?: string }) => void) => listeners.add(l), removeListener: (l: (id: number, info: { status?: string }) => void) => listeners.delete(l) },
    },
  };
  return { store, tabs, browser, reset: () => { for (const k of Object.keys(store)) delete store[k]; tabs.clear(); listeners.clear(); nextId = 1; } };
});

vi.mock('wxt/browser', () => ({ browser: h.browser }));

import { createCrawler } from './crawler';

class Err extends Error {
  constructor(public code: string, message: string) { super(message); }
}

type Page = (url: string, method: string, args?: any) => any;
function setup({ enabled = true, blocked = [] as string[], page = (() => ({})) as Page } = {}) {
  const state = { enabled };
  const calls: Array<{ method: string; url: string }> = [];
  const deps = {
    run: async (tabId: number, method: string, args: any) => {
      const url = h.tabs.get(tabId)?.url ?? '';
      calls.push({ method, url });
      if (method === 'waitStable') return {};
      return page(url, method, args);
    },
    guard: (url: string | undefined) => {
      const u = new URL(url ?? '');
      if (blocked.includes(u.hostname)) throw new Err('BLOCKED', `${u.hostname} is blocked`);
      return u;
    },
    getSettings: async () => ({ enabled: state.enabled, blocklist: blocked }),
    audit: vi.fn(),
    Err,
  };
  return { crawler: createCrawler(deps as any), state, calls, deps };
}

const S = { enabled: true, blocklist: [] as string[] };
const pageNo = (url: string) => Number(new URL(url).searchParams.get('p') ?? 1);
const TEMPLATE = 'https://shop.test/list?p={n}';
// Page n lists items n*10+1 .. n*10+2, each with a link column.
const listPage: Page = (url, method) =>
  method === 'detect'
    ? { best: { rowSelector: 'li', columns: ['name', 'link'], rows: [1, 2].map((i) => [`item ${pageNo(url) * 10 + i}`, `https://shop.test/i/${pageNo(url) * 10 + i}`]) } }
    : {};
const fast = { delayMs: 0, waitSec: 25 } as const;

beforeEach(() => { h.reset(); vi.stubGlobal('fetch', async () => { throw new Error('offline'); }); });
afterEach(() => vi.unstubAllGlobals());

describe('createCrawler', () => {
  it('follows a url template page by page and stops at maxPages', async () => {
    const { crawler } = setup({ page: listPage });
    const st = await crawler.start({ pagination: { urlTemplate: TEMPLATE }, maxPages: 3, ...fast }, S);
    expect(st.state).toBe('finished');
    expect(st.stopReason).toBe('max_pages');
    expect(st.pages).toBe(3);
    expect(st.rows).toBe(6);
    const r = await crawler.rows(st.id);
    expect(r.columns).toEqual(['name', 'link']);
    expect(r.rows.map((x) => x[0])).toEqual(['item 11', 'item 12', 'item 21', 'item 22', 'item 31', 'item 32']);
  }, 20000);

  it('stops with no_new_rows when a page only repeats rows already stored', async () => {
    const { crawler } = setup({ page: (url, m) => listPage('https://shop.test/list?p=1', m) });
    const st = await crawler.start({ pagination: { urlTemplate: TEMPLATE }, maxPages: 5, ...fast }, S);
    expect(st.stopReason).toBe('no_new_rows');
    expect(st.rows).toBe(2);
  }, 20000);

  it('drops duplicate rows inside one page and caps the stored rows at maxRows', async () => {
    const { crawler } = setup({
      page: (_u, m) => (m === 'detect' ? { best: { rowSelector: 'li', columns: ['name'], rows: [['a'], ['a'], ['b'], ['c'], ['d']] } } : {}),
    });
    const st = await crawler.start({ url: 'https://shop.test/x', maxRows: 3, ...fast }, S);
    expect(st.stopReason).toBe('max_rows');
    expect((await crawler.rows(st.id)).rows).toEqual([['a'], ['b'], ['c']]);
  });

  it('reports no_rows when the first page has nothing to extract', async () => {
    const { crawler } = setup({ page: () => ({ best: null }) });
    const st = await crawler.start({ url: 'https://shop.test/empty', ...fast }, S);
    expect(st.stopReason).toBe('no_rows');
  }, 20000);

  it('stops with "disabled" when the extension is switched off', async () => {
    const { crawler } = setup({ enabled: false, page: listPage });
    const st = await crawler.start({ url: 'https://shop.test/list?p=1', ...fast }, S);
    expect(st.stopReason).toBe('disabled');
    expect(st.rows).toBe(0);
  });

  it('validates arguments before opening a tab', async () => {
    const { crawler } = setup({ blocked: ['evil.test'] });
    await expect(crawler.start({ mode: 'fields', url: 'https://shop.test/' }, S)).rejects.toMatchObject({ code: 'BAD_ARGS' });
    await expect(crawler.start({ url: 'https://shop.test/', pagination: { type: 'template' } }, S)).rejects.toMatchObject({ code: 'BAD_ARGS' });
    await expect(crawler.start({ url: 'https://evil.test/' }, S)).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(crawler.start({}, S)).rejects.toMatchObject({ code: 'NO_TAB' });
    expect(h.tabs.size).toBe(0);
  });

  it('respectRobots refuses a disallowed path; without it the crawl runs and reports robots=disallowed', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, text: async () => 'User-agent: *\nDisallow: /private\n' }));
    const { crawler } = setup({ page: listPage });
    await expect(crawler.start({ url: 'https://shop.test/private/list', respectRobots: true }, S)).rejects.toMatchObject({ code: 'ROBOTS' });
    const st = await crawler.start({ url: 'https://shop.test/private/list?p=1', maxPages: 1, ...fast }, S);
    expect(st.robots).toBe('disallowed');
    expect(st.rows).toBe(2);
  });

  it('a robots.txt server error is "unknown" and does not block', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503, text: async () => '' }));
    const { crawler } = setup({ page: listPage });
    const st = await crawler.start({ url: 'https://shop.test/list?p=1', respectRobots: true, maxPages: 1, ...fast }, S);
    expect(st.robots).toBe('unknown');
    expect(st.rows).toBe(2);
  });

  it('only one crawl runs at a time; cancel stops it', async () => {
    const { crawler } = setup({ page: listPage });
    const first = await crawler.start({ pagination: { urlTemplate: TEMPLATE }, maxPages: 50, delayMs: 5000, waitSec: 0 }, S);
    expect(first.state).toBe('running');
    await expect(crawler.start({ url: 'https://shop.test/other' }, S)).rejects.toMatchObject({ code: 'BUSY' });
    const c = await crawler.cancel(first.id);
    expect(c.stopReason).toBe('cancelled');
    expect(crawler.isRunning()).toBe(false);
  }, 20000);

  it('next-link pagination moves to the link, ends when there is none, and refuses another site', async () => {
    const mk = (nextOf: (url: string) => any) =>
      setup({
        page: (url, m) => {
          if (m === 'findNext') return nextOf(url);
          return listPage(url, m);
        },
      }).crawler;
    const viaLink = mk((url) => (pageNo(url) < 2 ? { kind: 'link', href: `https://shop.test/list?p=${pageNo(url) + 1}` } : null));
    const a = await viaLink.start({ url: 'https://shop.test/list?p=1', maxPages: 9, ...fast }, S);
    expect(a.stopReason).toBe('done_no_next');
    expect(a.pages).toBe(2);
    h.reset();
    const offSite = mk(() => ({ kind: 'link', href: 'https://other.test/list?p=2' }));
    const b = await offSite.start({ url: 'https://shop.test/list?p=1', maxPages: 9, ...fast }, S);
    expect(b.stopReason).toBe('off_site');
    expect(b.pages).toBe(1);
  }, 20000);

  describe('detail pages', () => {
    const withDetail = (extra: Partial<Record<string, any>> = {}): Page => (url, m, args) => {
      if (m === 'detect') {
        return {
          best: {
            rowSelector: 'li',
            columns: ['name', 'link'],
            rows: [
              ['ok item', 'https://shop.test/i/1'],
              ['no link', ''],
              ['other site', 'https://elsewhere.test/i/3'],
              ['blocked', 'https://evil.test/i/4'],
            ],
          },
        };
      }
      if (m === 'detail') return extra.detail ? extra.detail(url, args) : { columns: ['title'], cells: [`T:${new URL(url).pathname}`] };
      return {};
    };

    it('appends detail cells and a status per row (ok, no_link, off_site, blocked)', async () => {
      const { crawler } = setup({ blocked: ['evil.test'], page: withDetail() });
      const st = await crawler.start({ url: 'https://shop.test/list', detail: { fields: { title: { selector: 'h1' } } }, maxPages: 1, ...fast }, S);
      expect(st.details).toBe(1);
      const r = await crawler.rows(st.id);
      expect(r.columns).toEqual(['name', 'link', 'title', 'detail_status']);
      expect(r.rows).toEqual([
        ['ok item', 'https://shop.test/i/1', 'T:/i/1', 'ok'],
        ['no link', '', '', 'no_link'],
        ['other site', 'https://elsewhere.test/i/3', '', 'off_site'],
        ['blocked', 'https://evil.test/i/4', '', 'blocked'],
      ]);
    }, 20000);

    it('gives up after 3 failed visits in a row', async () => {
      const rows = Array.from({ length: 6 }, (_, i) => [`n${i}`, `https://shop.test/i/${i}`]);
      const { crawler } = setup({
        page: (url, m) => (m === 'detect' ? { best: { rowSelector: 'li', columns: ['name', 'link'], rows } } : m === 'detail' ? (() => { throw new Err('INTERNAL', 'broken'); })() : {}),
      });
      const st = await crawler.start({ url: 'https://shop.test/list', detail: { fields: { title: { selector: 'h1' } } }, maxPages: 1, ...fast }, S);
      expect(st.stopReason).toBe('detail_errors');
      expect(st.details).toBe(3);
      expect((await crawler.rows(st.id)).rows.map((r) => r.at(-1))).toEqual(['error', 'error', 'error']);
    }, 20000);

    it('stops at maxDetails and a missing link column is an error that names the columns', async () => {
      const { crawler } = setup({ page: withDetail() });
      const st = await crawler.start({ url: 'https://shop.test/list', detail: { fields: { title: { selector: 'h1' } }, maxDetails: 1 }, maxPages: 1, ...fast }, S);
      expect(st.stopReason).toBe('max_details');
      h.reset();
      const { crawler: c2 } = setup({ page: withDetail() });
      const bad = await c2.start({ url: 'https://shop.test/list', detail: { linkColumn: 'nope', fields: { title: { selector: 'h1' } } }, ...fast }, S);
      expect(bad.stopReason).toBe('error');
      expect(bad.error).toMatch(/"nope" is not one of the columns \(name, link\)/);
    }, 20000);
  });
});
