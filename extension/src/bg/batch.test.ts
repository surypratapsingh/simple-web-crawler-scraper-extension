// Runs createBatch against a fake browser (storage, tabs) and a fake page runner,
// so the visit loop, stop reasons, de-duplication and discovery are tested without Chrome.
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  return { store, listeners, tabs, browser, reset: () => { for (const k of Object.keys(store)) delete store[k]; tabs.clear(); listeners.clear(); nextId = 1; } };
});

vi.mock('wxt/browser', () => ({ browser: h.browser }));

import { createBatch } from './batch';

class Err extends Error {
  constructor(public code: string, message: string) { super(message); }
}

interface Opts { enabled?: boolean; blocked?: string[]; page?: (url: string, method: string) => any; }
function setup({ enabled = true, blocked = [], page = () => ({}) }: Opts = {}) {
  const state = { enabled };
  const calls: Array<{ method: string; url: string }> = [];
  const deps = {
    run: async (tabId: number, method: string) => {
      const url = h.tabs.get(tabId)?.url ?? '';
      calls.push({ method, url });
      if (method === 'waitStable') return {};
      return page(url, method);
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
  return { batch: createBatch(deps as any), state, calls, deps };
}

const S = { enabled: true, blocklist: [] as string[] };
const detailPage = (url: string, method: string) => (method === 'detail' ? { columns: ['title'], cells: [`T:${new URL(url).pathname}`] } : {});
const fast = { delayMs: 0, waitSec: 25 } as const;

beforeEach(() => h.reset());

describe('createBatch', () => {
  it('visits each url once, in order, and collects one row per page', async () => {
    const { batch } = setup({ page: detailPage });
    const st = await batch.start({ task: 'extract', urls: ['https://a.test/1', 'https://a.test/2', 'https://a.test/1'], ...fast }, S);
    expect(st.state).toBe('finished');
    expect(st.stopReason).toBe('done');
    expect(st.visited).toBe(2);
    const r = await batch.rows(st.id, 0, 100);
    expect(r.columns).toEqual(['url', 'title']);
    expect(r.rows).toEqual([['https://a.test/1', 'T:/1'], ['https://a.test/2', 'T:/2']]);
  });

  it('rejects an empty job and a blocked url before opening any tab', async () => {
    const { batch } = setup({ blocked: ['evil.test'] });
    await expect(batch.start({ task: 'extract' }, S)).rejects.toMatchObject({ code: 'BAD_ARGS' });
    await expect(batch.start({ task: 'extract', urls: ['https://evil.test/x'] }, S)).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(h.tabs.size).toBe(0);
  });

  it('stops with "disabled" without visiting anything when the extension is switched off', async () => {
    const { batch } = setup({ enabled: false, page: detailPage });
    const st = await batch.start({ task: 'extract', urls: ['https://a.test/1'], ...fast }, S);
    expect(st.stopReason).toBe('disabled');
    expect(st.visited).toBe(0);
  });

  it('stops at maxPages and says so', async () => {
    const { batch } = setup({ page: detailPage });
    const st = await batch.start({ task: 'extract', urls: ['https://a.test/1', 'https://a.test/2', 'https://a.test/3'], maxPages: 1, ...fast }, S);
    expect(st.stopReason).toBe('max_pages');
    expect(st.visited).toBe(1);
  });

  it('a page that fails keeps its error message in the row and the job goes on', async () => {
    const { batch } = setup({
      page: (url, method) => {
        if (method === 'detail' && url.endsWith('/bad')) throw new Error('boom');
        return detailPage(url, method);
      },
    });
    const st = await batch.start({ task: 'extract', urls: ['https://a.test/bad', 'https://a.test/ok'], ...fast }, S);
    expect(st.stopReason).toBe('done');
    const { columns, rows } = await batch.rows(st.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(columns.length);
    expect(rows[0][0]).toBe('https://a.test/bad');
    expect(rows[0].at(-1)).toBe('boom');
    expect(rows[1]).toEqual(['https://a.test/ok', 'T:/ok']);
  });

  it('contacts task joins emails, phones and social links', async () => {
    const { batch } = setup({
      page: (_u, m) => (m === 'contacts' ? { emails: ['mail-one', 'mail-two'], phones: ['123'], social: [{ platform: 'x', url: 'https://x.test/u' }] } : {}),
    });
    const st = await batch.start({ task: 'contacts', urls: ['https://a.test/c'], ...fast }, S);
    const r = await batch.rows(st.id);
    expect(r.columns).toEqual(['url', 'emails', 'phones', 'social']);
    expect(r.rows).toEqual([['https://a.test/c', 'mail-one | mail-two', '123', 'x:https://x.test/u']]);
  });

  it('images task writes one row per image', async () => {
    const { batch } = setup({
      page: (_u, m) => (m === 'images' ? { images: [{ src: 's1', alt: 'a1', width: 10, height: 20 }, { src: 's2', alt: '', width: 1, height: 2 }] } : {}),
    });
    const st = await batch.start({ task: 'images', urls: ['https://a.test/p'], ...fast }, S);
    const r = await batch.rows(st.id);
    expect(r.columns).toEqual(['page_url', 'src', 'alt', 'width', 'height']);
    expect(r.rows).toEqual([['https://a.test/p', 's1', 'a1', '10', '20'], ['https://a.test/p', 's2', '', '1', '2']]);
  });

  it('discover follows only same-site links, once each, up to maxPages', async () => {
    const { batch, calls } = setup({
      page: (url, m) => {
        if (m === 'links') {
          return { links: url.endsWith('/start') ? ['https://a.test/x', 'https://a.test/x', 'https://other.test/y', 'https://sub.a.test/z', 'https://a.test/start'] : [] };
        }
        return detailPage(url, m);
      },
    });
    const st = await batch.start({ task: 'extract', discover: { url: 'https://a.test/start', maxPages: 10 }, ...fast }, S);
    expect(st.stopReason).toBe('done');
    const { rows } = await batch.rows(st.id);
    expect(rows.map((r) => r[0]).sort()).toEqual(['https://a.test/start', 'https://a.test/x', 'https://sub.a.test/z']);
    expect(calls.some((c) => c.url.includes('other.test'))).toBe(false);
  });

  it('only one job runs at a time, cancel stops it, and a second one can start after', async () => {
    const { batch } = setup({ page: detailPage });
    const first = await batch.start({ task: 'extract', urls: ['https://a.test/1', 'https://a.test/2', 'https://a.test/3'], delayMs: 5000, waitSec: 0 }, S);
    expect(first.state).toBe('running');
    await expect(batch.start({ task: 'extract', urls: ['https://a.test/9'] }, S)).rejects.toMatchObject({ code: 'BUSY' });
    const cancelled = await batch.cancel(first.id);
    expect(cancelled.stopReason).toBe('cancelled');
    expect(batch.isRunning()).toBe(false);
    const second = await batch.start({ task: 'extract', urls: ['https://a.test/9'], ...fast }, S);
    expect(second.stopReason).toBe('done');
  });

  it('a closed tab ends the job as tab_closed', async () => {
    const { batch } = setup({ page: detailPage });
    const first = await batch.start({ task: 'extract', urls: ['https://a.test/1', 'https://a.test/2'], delayMs: 600, waitSec: 0 }, S);
    h.tabs.clear();
    const st = await batch.status(first.id, 25);
    expect(st.stopReason).toBe('tab_closed');
  });

  it('keeps only the three newest jobs in storage', async () => {
    const { batch } = setup({ page: detailPage });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const st = await batch.start({ task: 'extract', urls: [`https://a.test/${i}`], ...fast }, S);
      ids.push(st.id);
      await new Promise((r) => setTimeout(r, 5)); // ids come from Date.now(); keep them distinct
    }
    const keys = Object.keys(h.store).filter((k) => k.startsWith('batch:job:'));
    expect(keys).toHaveLength(3);
    expect(keys).toContain(`batch:job:${ids[4]}`);
    expect(keys).not.toContain(`batch:job:${ids[0]}`);
  });

  it('calls audit for every visited page', async () => {
    const { batch, deps } = setup({ page: detailPage });
    await batch.start({ task: 'extract', urls: ['https://a.test/1', 'https://a.test/2'], ...fast }, S);
    expect(deps.audit).toHaveBeenCalledTimes(2);
    expect(deps.audit.mock.calls[0][0]).toMatchObject({ method: 'batch_page', host: 'a.test', ok: true });
  });
});
