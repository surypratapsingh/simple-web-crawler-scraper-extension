import { DEFAULT_PORT, ErrorCodes, HOST, type Msg, type Req, type Res } from '../../../packages/protocol/src/index';
import { createBatch, type BatchParams } from '../bg/batch';
import { createCrawler, type CrawlParams } from '../bg/crawler';
import { toPairs } from '../core/crawl-util';

interface Settings {
  enabled: boolean;
  port: number;
  token: string;
  blocklist: string[];
}
const DEFAULTS: Settings = { enabled: true, port: DEFAULT_PORT, token: '', blocklist: [] };

class ExtError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function getSettings(): Promise<Settings> {
  const s = await browser.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...s } as Settings;
}

// ------------------------------------------------------------------ audit log

let auditChain: Promise<void> = Promise.resolve();
function audit(entry: { method: string; host: string; ok: boolean; ms: number; code?: string }) {
  auditChain = auditChain
    .then(async () => {
      const { audit: log = [] } = (await browser.storage.local.get('audit')) as { audit?: unknown[] };
      log.push({ t: Date.now(), ...entry });
      await browser.storage.local.set({ audit: log.slice(-100) });
    })
    .catch(() => {});
}

// ------------------------------------------------------------------- guards

function guard(url: string | undefined, s: Settings): URL {
  if (!url) throw new ExtError(ErrorCodes.NO_TAB, 'tab has no url');
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ExtError(ErrorCodes.BAD_URL, `bad url: ${url}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ExtError(ErrorCodes.BLOCKED, `only http(s) pages are readable (got ${u.protocol})`);
  }
  if (u.hostname === 'chromewebstore.google.com' || (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'))) {
    throw new ExtError(ErrorCodes.BLOCKED, 'Chrome Web Store pages are restricted');
  }
  if (s.blocklist.some((h) => h && (u.hostname === h || u.hostname.endsWith('.' + h)))) {
    throw new ExtError(ErrorCodes.BLOCKED, `${u.hostname} is on the block list`);
  }
  return u;
}

async function resolveTab(tabId: unknown, s: Settings) {
  let tab: Browser.tabs.Tab | undefined;
  if (typeof tabId === 'number') {
    tab = await browser.tabs.get(tabId).catch(() => undefined);
  } else {
    tab =
      (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0] ??
      (await browser.tabs.query({ active: true }))[0];
  }
  if (!tab?.id) throw new ExtError(ErrorCodes.NO_TAB, 'no such tab');
  const url = guard(tab.url, s);
  return { id: tab.id, url };
}

// ------------------------------------------------------------------ injection

// A navigation that is still committing (or a page the user just navigated) makes executeScript fail
// with "Frame with ID 0 was removed" / "No frame with id". Those are transient: wait and retry.
const TRANSIENT = /Frame with ID \d+ was removed|No frame with id|frame was removed|Cannot access .*navigat|Receiving end does not exist/i;

async function retrying<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1 || !TRANSIENT.test(e instanceof Error ? e.message : String(e))) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
}

async function run(tabId: number, method: string, args: object, frameId?: number): Promise<any> {
  const target = frameId ? { tabId, frameIds: [frameId] } : { tabId };
  const [r] = await retrying(async () => {
    await browser.scripting.executeScript({ target, files: ['/injected.js'] });
    return browser.scripting.executeScript({
      target,
      func: (m: string, a: object) => (window as any).__scrapeline[m](a),
      args: [method, args],
    });
  });
  const result = r?.result as any;
  if (result === undefined) throw new ExtError(ErrorCodes.INTERNAL, 'page returned nothing (navigating?)');
  if (result && typeof result === 'object' && '__error' in result) throw new ExtError(ErrorCodes.INTERNAL, result.__error);
  return result;
}

/** Sub-frames worth mentioning: real-sized http(s) frames that are not on the block list. */
async function listFrames(tabId: number, s: Settings) {
  const results = await browser.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: () => ({ url: location.href, w: innerWidth, h: innerHeight }),
    })
    .catch(() => []);
  const frames: Array<{ frameId: number; host: string; path: string; w: number; h: number }> = [];
  for (const r of results) {
    const v = r.result as { url: string; w: number; h: number } | undefined;
    if (!r.frameId || !v || v.w < 60 || v.h < 60) continue;
    try {
      const u = guard(v.url, s);
      frames.push({ frameId: r.frameId, host: u.host, path: u.pathname, w: v.w, h: v.h });
    } catch {
      /* about:blank, blocked hosts, non-http */
    }
  }
  return frames.slice(0, 8);
}

/** A frameId must point at a real, readable, non-blocked frame of this tab. */
async function checkFrame(tabId: number, frameId: number, s: Settings) {
  const [r] = await browser.scripting
    .executeScript({ target: { tabId, frameIds: [frameId] }, func: () => location.href })
    .catch(() => []);
  if (!r) throw new ExtError(ErrorCodes.NO_TAB, `no readable frame ${frameId} in this tab (see page_outline "Frames")`);
  guard(r.result as string, s);
}

const deps = { run, guard, getSettings, audit, Err: ExtError };
const crawler = createCrawler(deps);
const batch = createBatch(deps);

const INJECTED: Record<string, string> = {
  page_info: 'info',
  page_outline: 'outline',
  page_text: 'text',
  page_query: 'query',
  page_scroll: 'scroll',
  page_contacts: 'contacts',
  page_images: 'images',
};

async function dispatch(method: string, p: Record<string, any>, s: Settings): Promise<unknown> {
  switch (method) {
    case 'list_tabs': {
      const tabs = await browser.tabs.query({});
      return tabs
        .filter((t) => t.id !== undefined)
        .map((t) => {
          let blocked = false;
          try {
            guard(t.url, s);
          } catch {
            blocked = true;
          }
          return {
            id: t.id!,
            windowId: t.windowId,
            active: t.active,
            title: blocked ? '(restricted)' : t.title,
            url: blocked ? '(restricted)' : t.url,
          };
        });
    }
    case 'page_info':
    case 'page_outline':
    case 'page_text':
    case 'page_query':
    case 'page_scroll':
    case 'page_contacts':
    case 'page_images': {
      const { id } = await resolveTab(p.tabId, s);
      const { tabId: _t, frameId, ...args } = p;
      if (frameId) await checkFrame(id, frameId, s);
      const result = await run(id, INJECTED[method], args, frameId);
      if (method === 'page_outline' && !frameId) {
        const frames = await listFrames(id, s);
        if (frames.length) {
          const lines = frames.map((f) => `frame ${f.frameId}: ${f.host}${f.path} ${f.w}x${f.h}`);
          result.text += `\n## Frames (pass frameId to page_text / page_extract / page_query / page_outline)\n${lines.join('\n')}`;
        }
      }
      return result;
    }
    case 'page_extract': {
      const { id } = await resolveTab(p.tabId, s);
      const frameId: number | undefined = p.frameId;
      if (frameId) await checkFrame(id, frameId, s);
      const limit = typeof p.limit === 'number' ? p.limit : 30;
      if (p.mode === 'fields') {
        if (!p.rowSelector || !p.fields) throw new ExtError(ErrorCodes.INTERNAL, 'mode=fields needs rowSelector and fields');
        return run(id, 'extractFields', { rowSelector: p.rowSelector, fields: toPairs(p.fields), limit }, frameId);
      }
      const d = await run(id, 'detect', { limit }, frameId);
      if (!d.best) return { none: true, reason: 'no repeating rows or tables with 2+ columns found' };
      return { ...d.best, others: d.candidates.slice(1) };
    }
    case 'open_url': {
      const u = guard(p.url, s);
      const tab = await browser.tabs.create({ url: u.href, active: p.active === true });
      await new Promise<void>((resolve) => {
        const done = () => {
          browser.tabs.onUpdated.removeListener(listener);
          clearTimeout(timer);
          resolve();
        };
        const listener = (id: number, info: { status?: string }) => {
          if (id === tab.id && info.status === 'complete') done();
        };
        const timer = setTimeout(done, 20_000);
        browser.tabs.onUpdated.addListener(listener);
        browser.tabs.get(tab.id!).then((t) => t.status === 'complete' && done());
      });
      const t = await browser.tabs.get(tab.id!);
      return { tabId: t.id, title: t.title, url: t.url, status: t.status };
    }
    case 'crawl_start':
      return crawler.start(p as CrawlParams, s);
    case 'crawl_status':
      return crawler.status(p.id, p.waitSec);
    case 'crawl_cancel':
      return crawler.cancel(p.id);
    case 'crawl_rows':
      return crawler.rows(p.id, p.offset, p.limit);
    case 'crawl_saved':
      return crawler.saved(p.id, p.path);
    case 'batch_start':
      return batch.start(p as BatchParams, s);
    case 'batch_status':
      return batch.status(p.id, p.waitSec);
    case 'batch_cancel':
      return batch.cancel(p.id);
    case 'batch_rows':
      return batch.rows(p.id, p.offset, p.limit);
    case 'batch_saved':
      return batch.saved(p.id, p.path);
    default:
      throw new ExtError(ErrorCodes.BAD_METHOD, `unknown method ${method}`);
  }
}

// ---------------------------------------------------------------- connection

let ws: WebSocket | null = null;
let backoff = 500;
let retry: ReturnType<typeof setTimeout> | undefined;

function reply(sock: WebSocket, res: Res) {
  if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(res));
}

async function handle(sock: WebSocket, req: Req) {
  const t0 = Date.now();
  const s = await getSettings();
  const params = (req.params ?? {}) as Record<string, any>;
  let host = '';
  try {
    if (req.method === 'status') {
      return reply(sock, {
        type: 'res',
        id: req.id,
        ok: true,
        result: { version: browser.runtime.getManifest().version, enabled: s.enabled },
      });
    }
    if (!s.enabled) throw new ExtError(ErrorCodes.DISABLED, 'Claude access is switched off');
    const result = await dispatch(req.method, params, s);
    host = hostOf(params, result);
    reply(sock, { type: 'res', id: req.id, ok: true, result });
    audit({ method: req.method, host, ok: true, ms: Date.now() - t0 });
  } catch (e) {
    const code = e instanceof ExtError ? e.code : ErrorCodes.INTERNAL;
    reply(sock, { type: 'res', id: req.id, ok: false, error: { code, message: e instanceof Error ? e.message : String(e) } });
    audit({ method: req.method, host, ok: false, ms: Date.now() - t0, code });
  }
}

function hostOf(p: Record<string, any>, result: unknown): string {
  try {
    const url = p.url ?? (result as any)?.url ?? '';
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}

// Bumped whenever port/token change, so a connect() that read stale settings starts over
// (otherwise the worker could stay attached to the previous port's hub).
let epoch = 0;
let connecting = false;

async function connect() {
  if (connecting || (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) return;
  connecting = true;
  let s: Settings;
  try {
    let seen: number;
    do {
      seen = epoch;
      s = await getSettings();
    } while (seen !== epoch);
  } finally {
    connecting = false;
  }
  const sock = new WebSocket(`ws://${HOST}:${s.port}`);
  ws = sock;
  sock.onopen = () => {
    backoff = 500;
    sock.send(
      JSON.stringify({ type: 'hello', role: 'ext', version: browser.runtime.getManifest().version, token: s.token || undefined }),
    );
  };
  sock.onmessage = (ev) => {
    let m: Msg;
    try {
      m = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (m.type === 'ping') sock.send(JSON.stringify({ type: 'pong' }));
    else if (m.type === 'req') void handle(sock, m);
  };
  sock.onerror = () => {};
  sock.onclose = () => {
    if (ws === sock) ws = null;
    clearTimeout(retry);
    retry = setTimeout(() => void connect(), backoff);
    backoff = Math.min(backoff * 2, 5000);
  };
}

export default defineBackground(() => {
  void connect();
  void crawler.resume(); // continue a crawl that was running when this worker was killed
  void batch.resume();
  // Alarms wake a suspended service worker (min period 30 s) so we can reconnect / resume.
  browser.alarms.create('scrapeline-keepalive', { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener(() => {
    void connect();
    void crawler.resume();
    void batch.resume();
  });
  browser.runtime.onStartup.addListener(() => void connect());
  browser.runtime.onInstalled.addListener(() => void connect());

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.port || changes.token)) {
      epoch++;
      ws?.close();
      void connect();
    }
  });

  browser.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    if (msg?.type === 'ui:status') {
      void connect();
      sendResponse({ connected: ws?.readyState === WebSocket.OPEN });
    }
    return false;
  });
});
