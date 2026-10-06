import { browser } from 'wxt/browser';
import { ErrorCodes } from '../../../packages/protocol/src/index';
import { DETAIL_AUTO_COLUMNS, hostRelated, toPairs, type FieldPairs, type FieldSpec } from '../core/crawl-util';
import type { CrawlDeps } from './crawler';

// Generic "visit a list of pages" job: Page Extractor (explicit URL list, one row per page),
// Email/Social scanner (optionally discovering pages by following same-site links), and a
// multi-page image lister. Shares its persistence/resume pattern with crawler.ts but visits one
// URL queue in a single tab, with no pagination concept.

export type BatchTask = 'extract' | 'contacts' | 'images';

export interface BatchParams {
  /** Explicit pages to visit. */
  urls?: string[];
  /** Instead of (or in addition to) `urls`: start here and follow same-site links to find more pages. */
  discover?: { url: string; maxPages?: number };
  task: BatchTask;
  /** task=extract only. Omit fields for automatic JSON-LD/meta/text extraction. */
  fields?: Record<string, FieldSpec> | FieldPairs;
  textChars?: number;
  maxPages?: number;
  delayMs?: number;
  maxSeconds?: number;
  keepTab?: boolean;
  saveAs?: 'csv' | 'json' | 'ndjson';
  filename?: string;
  waitSec?: number;
}

type StopReason = 'done' | 'max_pages' | 'timeout' | 'cancelled' | 'disabled' | 'tab_closed' | 'error';

interface LogEntry {
  n: number;
  url: string;
  ok: boolean;
  ms: number;
}

interface JobMeta {
  id: string;
  state: 'running' | 'finished';
  stopReason?: StopReason;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  params: BatchParams;
  tabId: number;
  columns: string[];
  visited: number;
  rowCount: number;
  chunks: number;
  queue: string[];
  queued: string[]; // everything ever queued, for de-dup (queue is drained as we go)
  cursor: number; // index into `queue` of the next URL to visit
  log: LogEntry[];
  savedPath?: string;
}

interface Settings {
  enabled: boolean;
  blocklist: string[];
}

const LIMITS = { maxPages: 500, maxSeconds: 1800, minDelay: 500, keep: 3 };
const K = {
  job: (id: string) => `batch:job:${id}`,
  rows: (id: string, n: number) => `batch:rows:${id}:${n}`,
  index: 'batch:index',
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createBatch(deps: CrawlDeps) {
  const { run, guard, getSettings, Err } = deps;
  const running = new Map<string, { cancelled: boolean; done: Promise<void> }>();
  const live = new Map<string, JobMeta>();
  let resuming: Promise<void> | undefined;

  async function loadIndex(): Promise<string[]> {
    return ((await browser.storage.local.get(K.index))[K.index] as string[] | undefined) ?? [];
  }
  async function loadMeta(id: string): Promise<JobMeta | undefined> {
    return (await browser.storage.local.get(K.job(id)))[K.job(id)] as JobMeta | undefined;
  }
  const saveMeta = (m: JobMeta) => browser.storage.local.set({ [K.job(m.id)]: m });

  async function loadRows(m: JobMeta): Promise<string[][]> {
    const keys = Array.from({ length: m.chunks }, (_, i) => K.rows(m.id, i));
    if (!keys.length) return [];
    const got = await browser.storage.local.get(keys);
    return keys.flatMap((k) => (got[k] as string[][] | undefined) ?? []);
  }

  async function pruneOld(index: string[]) {
    while (index.length > LIMITS.keep) {
      const old = index.shift()!;
      const m = await loadMeta(old);
      if (m?.state === 'running') {
        index.unshift(old);
        return;
      }
      await browser.storage.local.remove([K.job(old), ...Array.from({ length: m?.chunks ?? 0 }, (_, i) => K.rows(old, i))]);
    }
  }

  function waitComplete(tabId: number, ms: number, requireLoading = false): Promise<void> {
    const t0 = Date.now();
    let sawLoading = false;
    return new Promise((resolve, reject) => {
      const l = (id: number, info: { status?: string }) => {
        if (id !== tabId) return;
        if (info.status === 'loading') sawLoading = true;
        if (info.status === 'complete' && (!requireLoading || sawLoading || Date.now() - t0 > 3000)) done();
      };
      const t = setTimeout(() => {
        cleanup();
        reject(new Err(ErrorCodes.TIMEOUT, `page did not finish loading within ${ms} ms`));
      }, ms);
      const cleanup = () => {
        browser.tabs.onUpdated.removeListener(l);
        clearTimeout(t);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      browser.tabs.onUpdated.addListener(l);
    });
  }

  async function settle(tabId: number) {
    await run(tabId, 'waitStable', { quietMs: 300, timeoutMs: 5000 }).catch(() => {});
  }

  async function openTab(url: string): Promise<number> {
    const t = await browser.tabs.create({ url, active: false });
    const id = t.id!;
    if ((await browser.tabs.get(id)).status !== 'complete') await waitComplete(id, 25_000);
    await settle(id);
    return id;
  }

  async function navigate(tabId: number, url: string) {
    const loaded = waitComplete(tabId, 25_000, true);
    loaded.catch(() => {});
    await browser.tabs.update(tabId, { url });
    await loaded;
    await settle(tabId);
  }

  async function visitTask(meta: JobMeta, p: BatchParams, tabId: number): Promise<string[]> {
    if (p.task === 'contacts') {
      const r = await run(tabId, 'contacts', {});
      return [r.emails.join(' | '), r.phones.join(' | '), r.social.map((s: { platform: string; url: string }) => `${s.platform}:${s.url}`).join(' | ')];
    }
    if (p.task === 'images') {
      const r = await run(tabId, 'images', {});
      return [String((r.images as unknown[]).length)]; // per-image rows are expanded by the caller (see loop)
    }
    const fields = toPairs(p.fields);
    const r = await run(tabId, 'detail', { fields, textChars: p.textChars });
    if (!meta.columns.length) meta.columns = ['url', ...r.columns];
    return r.cells as string[];
  }

  function columnsFor(p: BatchParams): string[] {
    if (p.task === 'contacts') return ['url', 'emails', 'phones', 'social'];
    if (p.task === 'images') return ['page_url', 'src', 'alt', 'width', 'height'];
    const dc = toPairs(p.fields);
    return ['url', ...(dc?.length ? dc.map(([n]) => n) : [...DETAIL_AUTO_COLUMNS])];
  }

  async function finish(meta: JobMeta, reason: StopReason, error?: string) {
    meta.state = 'finished';
    meta.stopReason = reason;
    meta.error = error;
    meta.finishedAt = Date.now();
    await saveMeta(meta);
    if (!meta.params.keepTab) await browser.tabs.remove(meta.tabId).catch(() => {});
  }

  async function loop(meta: JobMeta, ctl: { cancelled: boolean }) {
    const p = meta.params;
    const maxPages = Math.min(p.maxPages ?? (p.discover ? 20 : p.urls?.length ?? 20), LIMITS.maxPages);
    const maxMs = Math.min(p.maxSeconds ?? 300, LIMITS.maxSeconds) * 1000;
    const delay = Math.max(p.delayMs ?? 1000, LIMITS.minDelay);
    const discovering = !!p.discover;
    const startHost = discovering ? new URL(meta.queue[0] ?? meta.params.discover!.url).hostname : '';

    try {
      for (;;) {
        if (ctl.cancelled) return await finish(meta, 'cancelled');
        if (!(await getSettings()).enabled) return await finish(meta, 'disabled');
        if (Date.now() - meta.startedAt > maxMs) return await finish(meta, 'timeout');
        // "done" (nothing left to visit) is checked first: for an explicit url list, maxPages
        // defaults to the list length, so it would otherwise always report max_pages instead of
        // the more accurate "every url was visited".
        if (meta.cursor >= meta.queue.length) return await finish(meta, 'done');
        if (meta.visited >= maxPages) return await finish(meta, 'max_pages');
        if (!(await browser.tabs.get(meta.tabId).catch(() => null))) return await finish(meta, 'tab_closed');

        const url = meta.queue[meta.cursor++];
        const t0 = Date.now();
        let ok = true;
        try {
          await navigate(meta.tabId, url);
          if (discovering && meta.queue.length - meta.cursor < maxPages - meta.visited) {
            const disc = (await run(meta.tabId, 'links', {}).catch(() => ({ links: [] }))).links as string[];
            for (const link of disc) {
              if (meta.queued.includes(link)) continue;
              if (!hostRelated(new URL(link).hostname, startHost)) continue;
              meta.queued.push(link);
              meta.queue.push(link);
              if (meta.queue.length - meta.cursor >= maxPages - meta.visited + 5) break;
            }
          }
          if (p.task === 'images') {
            const r = await run(meta.tabId, 'images', {});
            const rows = (r.images as Array<{ src: string; alt: string; width: number; height: number }>).map((im) => [
              url,
              im.src,
              im.alt,
              String(im.width),
              String(im.height),
            ]);
            if (!meta.columns.length) meta.columns = columnsFor(p);
            for (const row of rows) await appendRow(meta, row);
          } else {
            const cells = await visitTask(meta, p, meta.tabId);
            if (!meta.columns.length) meta.columns = columnsFor(p);
            await appendRow(meta, [url, ...cells]);
          }
        } catch (e) {
          ok = false;
          if (!meta.columns.length) meta.columns = columnsFor(p);
          await appendRow(meta, [url, ...Array(Math.max(0, meta.columns.length - 1)).fill(''), (e as Error).message ?? 'error'].slice(0, meta.columns.length));
        }
        meta.visited++;
        meta.log = [...meta.log, { n: meta.visited, url, ok, ms: Date.now() - t0 }].slice(-30);
        await saveMeta(meta);
        try {
          deps.audit({ method: 'batch_page', host: new URL(url).hostname, ok, ms: Date.now() - t0 });
        } catch {
          /* ignore */
        }

        if (meta.cursor < meta.queue.length || (discovering && meta.visited < maxPages)) {
          const until = Date.now() + delay + Math.random() * delay * 0.5;
          while (Date.now() < until && !ctl.cancelled) await sleep(Math.min(100, until - Date.now()));
        }
      }
    } catch (e) {
      await finish(meta, 'error', e instanceof Error ? e.message : String(e)).catch(() => {});
    } finally {
      running.delete(meta.id);
      live.delete(meta.id);
    }
  }

  let pendingRows: string[][] = [];
  async function appendRow(meta: JobMeta, row: string[]) {
    pendingRows.push(row);
    if (pendingRows.length >= 5) await flushRows(meta);
  }
  async function flushRows(meta: JobMeta) {
    if (!pendingRows.length) return;
    await browser.storage.local.set({ [K.rows(meta.id, meta.chunks)]: pendingRows });
    meta.chunks++;
    meta.rowCount += pendingRows.length;
    pendingRows = [];
    await saveMeta(meta);
  }

  function launch(meta: JobMeta) {
    if (running.has(meta.id)) return;
    pendingRows = [];
    const ctl = { cancelled: false, done: Promise.resolve() };
    live.set(meta.id, meta);
    ctl.done = loop(meta, ctl).finally(() => flushRows(meta));
    running.set(meta.id, ctl);
  }

  function status(m: JobMeta) {
    return {
      id: m.id,
      state: m.state,
      stopReason: m.stopReason,
      error: m.error,
      visited: m.visited,
      queued: m.queue.length,
      rows: m.rowCount,
      columns: m.columns,
      elapsedMs: (m.finishedAt ?? Date.now()) - m.startedAt,
      log: m.log.slice(-4),
      saveAs: m.params.saveAs,
      filename: m.params.filename,
      savedPath: m.savedPath,
    };
  }

  async function latestMeta(id?: string): Promise<JobMeta> {
    const target = id ?? (await loadIndex()).at(-1);
    const m = target ? (live.get(target) ?? (await loadMeta(target))) : undefined;
    if (!m) throw new Err(ErrorCodes.BAD_ARGS, id ? `no batch job ${id}` : 'no batch jobs yet');
    return m;
  }

  async function waitFor(id: string, sec: number) {
    const until = Date.now() + Math.min(Math.max(sec, 0), 25) * 1000;
    for (;;) {
      const m = await latestMeta(id);
      if (m.state === 'finished' || Date.now() >= until) return m;
      await sleep(250);
    }
  }

  async function start(input: BatchParams, s: Settings) {
    for (const [, r] of running) if (!r.cancelled) throw new Err(ErrorCodes.BUSY, 'a batch job is already running; batch_cancel it first');
    const p: BatchParams = { ...input, fields: toPairs(input.fields) };
    if (!p.urls?.length && !p.discover) throw new Err(ErrorCodes.BAD_ARGS, 'give urls, or discover.url to follow links');

    const initial: string[] = [];
    if (p.discover) initial.push(guard(p.discover.url, s).href);
    for (const u of p.urls ?? []) initial.push(guard(u, s).href);
    const dedup = [...new Set(initial)];
    if (!dedup.length) throw new Err(ErrorCodes.BAD_ARGS, 'no valid urls');

    const tabId = await openTab(dedup[0]);
    const meta: JobMeta = {
      id: 'b' + Date.now().toString(36),
      state: 'running',
      startedAt: Date.now(),
      params: p,
      tabId,
      columns: [],
      visited: 0,
      rowCount: 0,
      chunks: 0,
      queue: dedup,
      queued: [...dedup],
      // openTab already loaded dedup[0]; the loop's first navigate() re-loads it, which is
      // wasteful by one request but keeps the loop's logic (append rows, discover, log) uniform.
      cursor: 0,
      log: [],
    };
    await saveMeta(meta);
    const index = await loadIndex();
    index.push(meta.id);
    await pruneOld(index);
    await browser.storage.local.set({ [K.index]: index });
    launch(meta);
    return status(await waitFor(meta.id, p.waitSec ?? 20));
  }

  return {
    start,
    async status(id: string | undefined, waitSec = 0) {
      const m = await latestMeta(id);
      return status(waitSec > 0 ? await waitFor(m.id, waitSec) : m);
    },
    async cancel(id?: string) {
      const m = await latestMeta(id);
      const r = running.get(m.id);
      if (r) {
        r.cancelled = true;
        await r.done.catch(() => {});
      } else if (m.state === 'running') {
        await finish(m, 'cancelled');
      }
      return status(await latestMeta(m.id));
    },
    async rows(id: string | undefined, offset = 0, limit = 500) {
      const m = await latestMeta(id);
      const all = await loadRows(m);
      return { columns: m.columns, rows: all.slice(offset, offset + limit), total: all.length };
    },
    async saved(id: string, path: string) {
      const m = await latestMeta(id);
      m.savedPath = path;
      await saveMeta(m);
      return { ok: true };
    },
    resume(): Promise<void> {
      resuming ??= (async () => {
        for (const id of await loadIndex()) {
          if (running.has(id)) continue;
          const m = await loadMeta(id);
          if (m?.state !== 'running' || running.has(id)) continue;
          if (!(await browser.tabs.get(m.tabId).catch(() => null))) await finish(m, 'tab_closed');
          else launch(m);
        }
      })().finally(() => {
        resuming = undefined;
      });
      return resuming;
    },
    isRunning: () => running.size > 0,
  };
}

export type Batch = ReturnType<typeof createBatch>;
