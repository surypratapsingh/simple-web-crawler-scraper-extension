import { browser } from 'wxt/browser';
import { ErrorCodes } from '../../../packages/protocol/src/index';
import {
  alignRows,
  buildUrl,
  DETAIL_AUTO_COLUMNS,
  hostRelated,
  jitter,
  parseRobots,
  resolveLinkIndex,
  robotsAllows,
  rowKey,
  toPairs,
  uniqueNames,
  type FieldPairs,
  type FieldSpec,
  type StopReason,
} from '../core/crawl-util';

// Multi-page crawler. Runs as a persisted background job inside the service worker:
// state is written to storage after every page, and resume() continues any job that was
// running when the worker was killed.

/**
 * Follow each new row's link into a second background tab and append fields from the detail page.
 * Without `fields`, JSON-LD / meta / a text excerpt are extracted (columns d_title, d_price, ...).
 */
export interface DetailParams {
  /** Column holding the detail URL. Default: the first *_url / link / href column. */
  linkColumn?: string;
  /** Ordered field specs. Objects are accepted on input and normalized to ordered pairs when the job starts. */
  fields?: Record<string, FieldSpec> | FieldPairs;
  textChars?: number;
  maxDetails?: number;
}

export interface CrawlParams {
  detail?: DetailParams;
  url?: string;
  tabId?: number;
  /** Crawl inside the user's own tab (navigates it) instead of a private background tab. */
  inPlace?: boolean;
  mode?: 'auto' | 'fields';
  rowSelector?: string;
  fields?: Record<string, FieldSpec> | FieldPairs;
  pagination?: {
    type?: 'auto' | 'next' | 'template' | 'scroll';
    selector?: string;
    urlTemplate?: string;
    start?: number;
    step?: number;
  };
  maxPages?: number;
  maxRows?: number;
  delayMs?: number;
  maxSeconds?: number;
  respectRobots?: boolean;
  keepTab?: boolean;
  saveAs?: 'csv' | 'json' | 'ndjson';
  filename?: string;
  waitSec?: number;
}

interface LogEntry {
  page: number;
  url: string;
  found: number;
  added: number;
  ms: number;
}

interface JobMeta {
  id: string;
  state: 'running' | 'finished';
  stopReason?: StopReason;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  params: CrawlParams;
  tabId: number;
  ownedTab: boolean;
  pages: number;
  rowCount: number;
  chunks: number;
  /** All output columns: list columns, then (with detail) detail columns + detail_status. */
  columns: string[];
  /** Just the list-page columns. De-duplication keys on these, so resumed crawls never re-visit stored rows. */
  listColumns: string[];
  listCols: number;
  linkIdx: number;
  detailCols: number;
  detailTab?: number;
  details: number;
  detailFails: number;
  rowSelector?: string;
  cursor?: number;
  pendingUrl?: string;
  lastUrl: string;
  log: LogEntry[];
  robots: 'allowed' | 'disallowed' | 'unknown';
  savedPath?: string;
}

interface Settings {
  enabled: boolean;
  blocklist: string[];
}

export interface CrawlDeps {
  run(tabId: number, method: string, args: object, frameId?: number): Promise<any>;
  guard(url: string | undefined, s: Settings): URL;
  getSettings(): Promise<Settings>;
  audit(e: { method: string; host: string; ok: boolean; ms: number; code?: string }): void;
  Err: new (code: string, message: string) => Error;
}

const LIMITS = {
  maxPages: 100,
  maxRows: 5000,
  maxSeconds: 900,
  minDelay: 500,
  keep: 3,
  maxDetails: 2000,
  detailFailStreak: 3, // consecutive failed detail visits before giving up (avoid hammering a blocking site)
  flushEvery: 5, // rows per storage write while visiting details
};
/** Statuses that mean a real visit happened and produced nothing usable. */
const VISIT_FAILED = new Set(['empty', 'error', 'timeout']);
const K = {
  job: (id: string) => `crawl:job:${id}`,
  rows: (id: string, n: number) => `crawl:rows:${id}:${n}`,
  index: 'crawl:index',
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createCrawler(deps: CrawlDeps) {
  const { run, guard, getSettings, Err } = deps;
  const running = new Map<string, { cancelled: boolean; done: Promise<void> }>();
  let resuming: Promise<void> | undefined;
  const live = new Map<string, JobMeta>(); // in-memory meta of jobs running in this worker

  // ------------------------------------------------------------- storage

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
      const keys = [K.job(old), ...Array.from({ length: m?.chunks ?? 0 }, (_, i) => K.rows(old, i))];
      await browser.storage.local.remove(keys);
    }
  }

  // ---------------------------------------------------------- tab helpers

  /**
   * Resolve when the tab reports 'complete'. With requireLoading, a 'complete' is only accepted after
   * a 'loading' was seen (or 3 s passed), so a stale event from the previous document is ignored.
   */
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

  function waitLoading(tabId: number, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const l = (id: number, info: { status?: string }) => {
        if (id === tabId && info.status === 'loading') done(true);
      };
      const t = setTimeout(() => done(false), ms);
      const done = (v: boolean) => {
        browser.tabs.onUpdated.removeListener(l);
        clearTimeout(t);
        resolve(v);
      };
      browser.tabs.onUpdated.addListener(l);
    });
  }

  async function settle(tabId: number) {
    await run(tabId, 'waitStable', { quietMs: 400, timeoutMs: 6000 });
  }

  async function navigate(tabId: number, url: string) {
    const loaded = waitComplete(tabId, 25_000, true);
    loaded.catch(() => {});
    await browser.tabs.update(tabId, { url });
    await loaded;
    await settle(tabId);
  }

  // ------------------------------------------------------------- robots

  async function robotsStatus(u: URL): Promise<JobMeta['robots']> {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(`${u.origin}/robots.txt`, { signal: ctl.signal, credentials: 'omit' });
      clearTimeout(t);
      if (r.status >= 500) return 'unknown';
      if (!r.ok) return 'allowed';
      return robotsAllows(parseRobots(await r.text()), u.pathname + u.search) ? 'allowed' : 'disallowed';
    } catch {
      return 'unknown';
    }
  }

  // ------------------------------------------------------- detail pages

  /** Open a background tab and wait until it has loaded and settled. */
  async function openTab(url: string): Promise<number> {
    const t = await browser.tabs.create({ url, active: false });
    const id = t.id!;
    const loaded = waitComplete(id, 25_000);
    loaded.catch(() => {});
    if ((await browser.tabs.get(id)).status !== 'complete') await loaded;
    await settle(id);
    return id;
  }

  /** The second tab used for detail pages (created lazily, survives resume via meta.detailTab). */
  async function detailTabFor(meta: JobMeta, url: string): Promise<number> {
    if (meta.detailTab !== undefined && (await browser.tabs.get(meta.detailTab).catch(() => null))) {
      await navigate(meta.detailTab, url);
      return meta.detailTab;
    }
    meta.detailTab = await openTab(url);
    await saveMeta(meta);
    return meta.detailTab;
  }

  /** Visit one row's detail page. Returns the appended cells (detailCols wide) and a status word. */
  async function visitDetail(meta: JobMeta, p: CrawlParams, listRow: string[], s: Settings): Promise<[string[], string]> {
    const blank = Array<string>(meta.detailCols).fill('');
    const raw = listRow[meta.linkIdx];
    if (!raw) return [blank, 'no_link'];
    let u: URL;
    try {
      u = guard(raw, s);
    } catch (e) {
      return [blank, (e as { code?: string }).code === ErrorCodes.BLOCKED ? 'blocked' : 'bad_url'];
    }
    if (!hostRelated(u.hostname, new URL(meta.lastUrl).hostname)) return [blank, 'off_site'];

    meta.details++;
    const t0 = Date.now();
    try {
      const tabId = await detailTabFor(meta, u.href);
      const r = await run(tabId, 'detail', { fields: toPairs(p.detail!.fields), textChars: p.detail!.textChars });
      const cells = Array.from({ length: meta.detailCols }, (_, i) => (r.cells as string[])[i] ?? '');
      deps.audit({ method: 'crawl_detail', host: u.hostname, ok: true, ms: Date.now() - t0 });
      return [cells, cells.every((c) => !c) ? 'empty' : 'ok'];
    } catch (e) {
      const code = (e as { code?: string }).code;
      deps.audit({ method: 'crawl_detail', host: u.hostname, ok: false, ms: Date.now() - t0, code });
      return [blank, code === ErrorCodes.TIMEOUT ? 'timeout' : 'error'];
    }
  }

  // --------------------------------------------------------------- core

  async function extractPage(meta: JobMeta, p: CrawlParams, tabId: number) {
    if (p.mode === 'fields') {
      const r = await run(tabId, 'extractFields', { rowSelector: p.rowSelector, fields: toPairs(p.fields), limit: LIMITS.maxRows });
      return { columns: r.columns as string[], rows: r.rows as string[][] };
    }
    const d = await run(tabId, 'detect', { limit: LIMITS.maxRows, prefer: meta.rowSelector ?? p.rowSelector });
    if (!d.best) return null;
    meta.rowSelector ??= d.best.rowSelector;
    return { columns: d.best.columns as string[], rows: d.best.rows as string[][] };
  }

  type Advance = 'moved' | 'end' | 'no_effect' | 'off_site';

  async function advance(meta: JobMeta, p: CrawlParams, s: Settings): Promise<Advance> {
    const pg = p.pagination ?? {};
    const type = pg.type === 'auto' || !pg.type ? (pg.urlTemplate ? 'template' : 'next') : pg.type;
    const tabId = meta.tabId;

    const go = async (url: string) => {
      meta.pendingUrl = url; // lets resume() finish a navigation that was interrupted
      await saveMeta(meta);
      await navigate(tabId, url);
      meta.pendingUrl = undefined;
      await saveMeta(meta);
    };

    if (type === 'template') {
      if (!pg.urlTemplate) throw new Err(ErrorCodes.BAD_ARGS, 'pagination.urlTemplate is required for type=template');
      meta.cursor = (meta.cursor ?? pg.start ?? 1) + (pg.step ?? 1);
      const url = guard(buildUrl(pg.urlTemplate, meta.cursor), s).href;
      await go(url);
      return 'moved';
    }

    if (type === 'scroll') {
      await run(tabId, 'scroll', { direction: 'bottom', waitMs: 800 });
      await run(tabId, 'waitStable', { quietMs: 500, timeoutMs: 5000 });
      return 'moved';
    }

    const next = await run(tabId, 'findNext', { selector: pg.selector });
    if (!next) return 'end';
    const here = await browser.tabs.get(tabId);

    if (next.kind === 'link') {
      const u = guard(next.href, s);
      if (u.hostname !== new URL(here.url!).hostname) return 'off_site';
      if (u.href === here.url) return 'end';
      await go(u.href);
      return 'moved';
    }

    // Click target (button, "#" link, load-more). It may navigate or just change the DOM.
    const before = (await run(tabId, 'sig', {})).sig as string;
    const navStarted = waitLoading(tabId, 1500);
    const clicked = run(tabId, 'click', { ref: next.ref }).catch((e: Error) => e);
    if (await navStarted) {
      // 'loading' was seen; it may already have completed by now, so check before waiting.
      if ((await browser.tabs.get(tabId)).status !== 'complete') await waitComplete(tabId, 25_000).catch(() => {});
      await sleep(200);
      await settle(tabId);
      return 'moved';
    }
    const err = await clicked;
    if (err instanceof Error) throw err;
    const changed = (await run(tabId, 'waitChange', { before, timeoutMs: 6000 })).changed as boolean;
    if (!changed) return 'no_effect';
    await settle(tabId);
    return 'moved';
  }

  async function finish(meta: JobMeta, reason: StopReason, error?: string) {
    meta.state = 'finished';
    meta.stopReason = reason;
    meta.error = error;
    meta.finishedAt = Date.now();
    await saveMeta(meta);
    if (!meta.params.keepTab) {
      if (meta.ownedTab) await browser.tabs.remove(meta.tabId).catch(() => {});
      if (meta.detailTab !== undefined) await browser.tabs.remove(meta.detailTab).catch(() => {});
    }
  }

  async function loop(meta: JobMeta, ctl: { cancelled: boolean }, resumed: boolean) {
    const p = meta.params;
    const maxPages = Math.min(p.maxPages ?? 5, LIMITS.maxPages);
    const maxRows = Math.min(p.maxRows ?? 500, LIMITS.maxRows);
    const maxMs = Math.min(p.maxSeconds ?? 300, LIMITS.maxSeconds) * 1000;
    const delay = Math.max(p.delayMs ?? 1500, LIMITS.minDelay);
    const scrolling = p.pagination?.type === 'scroll';

    const maxDetails = Math.min(p.detail?.maxDetails ?? LIMITS.maxDetails, LIMITS.maxDetails);
    // Keyed on the list columns only (detail cells are appended after them).
    const seen = new Set((await loadRows(meta)).map((r) => rowKey(r.slice(0, meta.listCols || r.length))));
    const stopCheck = async (): Promise<StopReason | null> => {
      if (ctl.cancelled) return 'cancelled';
      if (!(await getSettings()).enabled) return 'disabled';
      if (Date.now() - meta.startedAt > maxMs) return 'timeout';
      return null;
    };
    const pause = async () => {
      const until = Date.now() + jitter(delay);
      while (Date.now() < until && !ctl.cancelled) await sleep(Math.min(100, until - Date.now()));
    };
    let stagnation = 0;
    let exempt = resumed; // the first page after a resume may legitimately repeat rows

    try {
      if (resumed && meta.pendingUrl) {
        await navigate(meta.tabId, meta.pendingUrl);
        meta.pendingUrl = undefined;
        exempt = true;
      }
      for (;;) {
        if (ctl.cancelled) return await finish(meta, 'cancelled');
        const s = await getSettings();
        if (!s.enabled) return await finish(meta, 'disabled');
        if (Date.now() - meta.startedAt > maxMs) return await finish(meta, 'timeout');
        const tab = await browser.tabs.get(meta.tabId).catch(() => null);
        if (!tab) return await finish(meta, 'tab_closed');
        try {
          guard(tab.url, s);
        } catch {
          return await finish(meta, 'blocked');
        }

        const t0 = Date.now();
        let ex = await extractPage(meta, p, meta.tabId);
        if (!ex && meta.pages === 0) {
          await sleep(1500); // content may still be rendering
          ex = await extractPage(meta, p, meta.tabId);
        }
        if (!ex || (meta.pages === 0 && ex.rows.length === 0)) {
          return await finish(meta, meta.pages === 0 ? 'no_rows' : 'done_no_next');
        }
        if (!meta.listColumns.length) {
          meta.listColumns = ex.columns;
          meta.listCols = ex.columns.length;
          meta.columns = [...ex.columns];
          if (p.detail) {
            meta.linkIdx = resolveLinkIndex(ex.columns, p.detail.linkColumn);
            if (meta.linkIdx < 0) {
              const cols = ex.columns.join(', ');
              return await finish(
                meta,
                'error',
                p.detail.linkColumn
                  ? `detail.linkColumn "${p.detail.linkColumn}" is not one of the columns (${cols})`
                  : `detail: no link column found among (${cols}); set detail.linkColumn`,
              );
            }
            const dfields = toPairs(p.detail.fields);
            const dc = dfields?.length ? dfields.map(([n]) => n) : [...DETAIL_AUTO_COLUMNS];
            meta.detailCols = dc.length;
            meta.columns = [...ex.columns, ...uniqueNames(ex.columns, [...dc, 'detail_status'])];
          }
        }
        const listRows = alignRows(ex.columns, meta.listColumns, ex.rows);
        const pageKeys = new Set<string>();
        const fresh: string[][] = [];
        for (const r of listRows) {
          const k = rowKey(r);
          if (!seen.has(k) && !pageKeys.has(k)) {
            pageKeys.add(k);
            fresh.push(r);
          }
        }
        meta.lastUrl = tab.url ?? meta.lastUrl;

        // Store new rows (in small batches while visiting detail pages, so a killed worker loses little).
        const take = fresh.slice(0, Math.max(0, maxRows - meta.rowCount));
        let added = 0;
        let batch: string[][] = [];
        let stop: StopReason | null = null;
        const flush = async () => {
          if (!batch.length) return;
          await browser.storage.local.set({ [K.rows(meta.id, meta.chunks)]: batch });
          meta.chunks++;
          meta.rowCount += batch.length;
          added += batch.length;
          batch = [];
          await saveMeta(meta);
        };
        for (const lr of take) {
          seen.add(rowKey(lr));
          if (!p.detail) {
            batch.push(lr);
            continue;
          }
          if ((stop = await stopCheck())) break;
          if (meta.details >= maxDetails) {
            stop = 'max_details';
            break;
          }
          const [cells, status] = await visitDetail(meta, p, lr, s);
          batch.push([...lr, ...cells, status]);
          if (status === 'ok') meta.detailFails = 0;
          else if (VISIT_FAILED.has(status)) meta.detailFails++;
          if (batch.length >= LIMITS.flushEvery) await flush();
          if (meta.detailFails >= LIMITS.detailFailStreak) {
            stop = 'detail_errors';
            break;
          }
          if (lr !== take[take.length - 1]) await pause();
        }
        await flush();

        // A page counts once, when it is finished. Re-reading a page whose rows were all stored before the
        // worker died (first iteration after a resume) is not a new page and must not use up maxPages.
        const redundant = exempt && take.length === 0;
        if (!redundant) {
          meta.pages++;
          meta.log = [...meta.log, { page: meta.pages, url: meta.lastUrl, found: listRows.length, added, ms: Date.now() - t0 }].slice(-30);
        }
        await saveMeta(meta);
        if (!redundant) {
          try {
            deps.audit({ method: 'crawl_page', host: new URL(meta.lastUrl).hostname, ok: true, ms: Date.now() - t0 });
          } catch {
            /* ignore */
          }
        }

        if (stop) return await finish(meta, stop);
        if (meta.rowCount >= maxRows) return await finish(meta, 'max_rows');
        if (meta.pages >= maxPages) return await finish(meta, 'max_pages');
        if (meta.pages > 1 && !exempt && added === 0) {
          if (++stagnation >= (scrolling ? 2 : 1)) return await finish(meta, 'no_new_rows');
        } else if (added) {
          stagnation = 0;
        }
        exempt = false;

        await pause(); // cancellable politeness delay
        if (ctl.cancelled) return await finish(meta, 'cancelled');

        const adv = await advance(meta, p, s);
        if (adv === 'end') return await finish(meta, 'done_no_next');
        if (adv === 'no_effect') return await finish(meta, 'next_no_effect');
        if (adv === 'off_site') return await finish(meta, 'off_site');
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      const reason: StopReason = code === ErrorCodes.BLOCKED ? 'blocked' : 'error';
      await finish(meta, reason, e instanceof Error ? e.message : String(e)).catch(() => {});
    } finally {
      running.delete(meta.id);
      live.delete(meta.id);
    }
  }

  function launch(meta: JobMeta, resumed: boolean) {
    if (running.has(meta.id)) return; // never two loops for one job (they would corrupt each other's chunks)
    const ctl = { cancelled: false, done: Promise.resolve() };
    live.set(meta.id, meta);
    ctl.done = loop(meta, ctl, resumed);
    running.set(meta.id, ctl);
  }

  // ---------------------------------------------------------------- API

  function status(m: JobMeta) {
    return {
      id: m.id,
      state: m.state,
      stopReason: m.stopReason,
      error: m.error,
      pages: m.pages,
      rows: m.rowCount,
      details: m.detailCols ? m.details : undefined,
      columns: m.columns,
      url: m.lastUrl,
      elapsedMs: (m.finishedAt ?? Date.now()) - m.startedAt,
      log: m.log.slice(-4),
      robots: m.robots,
      saveAs: m.params.saveAs,
      filename: m.params.filename,
      savedPath: m.savedPath,
    };
  }

  async function latestMeta(id?: string): Promise<JobMeta> {
    const target = id ?? (await loadIndex()).at(-1);
    const m = target ? (live.get(target) ?? (await loadMeta(target))) : undefined;
    if (!m) throw new Err(ErrorCodes.BAD_ARGS, id ? `no crawl job ${id}` : 'no crawl jobs yet');
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

  async function start(input: CrawlParams, s: Settings) {
    // Key order is lost across extension APIs (storage, executeScript), so fix the column order now, as arrays.
    const p: CrawlParams = {
      ...input,
      fields: toPairs(input.fields),
      detail: input.detail ? { ...input.detail, fields: toPairs(input.detail.fields) } : undefined,
    };
    for (const [id, r] of running) if (!r.cancelled) throw new Err(ErrorCodes.BUSY, `crawl ${id} is already running (one at a time); crawl_cancel it first`);
    const pg = p.pagination ?? {};
    const mode = p.mode ?? 'auto';
    if (mode === 'fields' && (!p.rowSelector || !p.fields)) throw new Err(ErrorCodes.BAD_ARGS, 'mode=fields needs rowSelector and fields');
    if (pg.type === 'template' && !pg.urlTemplate) throw new Err(ErrorCodes.BAD_ARGS, 'pagination.urlTemplate is required for type=template');

    // Where to start.
    let startUrl = p.url;
    let sourceTab: number | undefined = p.tabId;
    if (!startUrl && pg.urlTemplate) startUrl = buildUrl(pg.urlTemplate, pg.start ?? 1);
    if (!startUrl) {
      const t =
        sourceTab !== undefined
          ? await browser.tabs.get(sourceTab).catch(() => undefined)
          : ((await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0] ?? (await browser.tabs.query({ active: true }))[0]);
      if (!t?.url) throw new Err(ErrorCodes.NO_TAB, 'no tab to crawl; pass url or tabId');
      startUrl = t.url;
      sourceTab = t.id;
    }
    const u = guard(startUrl, s);
    const robots = await robotsStatus(u);
    if (robots === 'disallowed' && p.respectRobots) {
      throw new Err(ErrorCodes.ROBOTS, `robots.txt disallows ${u.pathname} for this crawler (respectRobots=true)`);
    }

    let tabId: number;
    let ownedTab = true;
    if (p.inPlace) {
      const t = sourceTab !== undefined ? await browser.tabs.get(sourceTab).catch(() => undefined) : (await browser.tabs.query({ active: true }))[0];
      if (!t?.id) throw new Err(ErrorCodes.NO_TAB, 'inPlace needs an existing tab');
      tabId = t.id;
      ownedTab = false;
      if (t.url !== u.href) await navigate(tabId, u.href);
    } else {
      tabId = await openTab(u.href);
    }

    const meta: JobMeta = {
      id: 'c' + Date.now().toString(36),
      state: 'running',
      startedAt: Date.now(),
      params: p,
      tabId,
      ownedTab,
      pages: 0,
      rowCount: 0,
      chunks: 0,
      columns: [],
      listColumns: [],
      listCols: 0,
      linkIdx: -1,
      detailCols: 0,
      details: 0,
      detailFails: 0,
      lastUrl: u.href,
      log: [],
      robots,
      cursor: pg.urlTemplate ? (pg.start ?? 1) : undefined,
    };
    await saveMeta(meta);
    const index = await loadIndex();
    index.push(meta.id);
    await pruneOld(index);
    await browser.storage.local.set({ [K.index]: index });
    launch(meta, false);
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
        await finish(m, 'cancelled'); // orphaned (worker restarted, not resumed yet)
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
    /**
     * Continue any job that was running when the worker was killed. Safe to call repeatedly and
     * concurrently (worker start and the alarm both call it): calls are serialized, because the
     * "already running?" check and the launch are separated by awaits.
     */
    resume(): Promise<void> {
      resuming ??= (async () => {
        for (const id of await loadIndex()) {
          if (running.has(id)) continue;
          const m = await loadMeta(id);
          if (m?.state !== 'running' || running.has(id)) continue;
          const alive = await browser.tabs.get(m.tabId).catch(() => null);
          if (!alive) await finish(m, 'tab_closed');
          else launch(m, true);
        }
      })().finally(() => {
        resuming = undefined;
      });
      return resuming;
    },
    isRunning: () => running.size > 0,
  };
}

export type Crawler = ReturnType<typeof createCrawler>;
