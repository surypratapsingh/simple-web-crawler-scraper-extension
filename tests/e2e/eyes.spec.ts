import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareExtension } from './harness';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const extPath = join(root, 'extension/.output/chrome-mv3');
const serverPath = join(root, 'mcp-server/dist/server.mjs');
const fixtures = join(root, 'tests/fixtures');
const localChromium = join(root, '.browsers/chrome-win64/chrome.exe');
// Playwright's bundled Chromium (and a copied binary under .browsers/) can get blocked by a
// Windows Application Control policy that distrusts executables copied into user/temp folders.
// Installed, signed browsers (msedge) are unaffected, so prefer msedge unless overridden.
const browserChannel = (process.env.SCRAPELINE_BROWSER_CHANNEL ?? 'msedge') as 'msedge' | 'chrome' | 'chromium';
const chromiumExe = process.env.SCRAPELINE_CHROMIUM ?? (existsSync(localChromium) ? localChromium : undefined);

const freePort = () =>
  new Promise<number>((res) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

let web: http.Server;
let web2: http.Server; // second origin (localhost:<port2>) for cross-origin iframes
let base = '';
let base2 = '';
let exportDir = '';

function fixtureServer(): http.Server {
  return http.createServer((req, res) => {
    const name = (req.url ?? '/').split('?')[0].replace(/^\//, '') || 'shop.html';
    try {
      const body = readFileSync(join(fixtures, name), 'utf8').replaceAll('{{OTHER}}', base2);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404).end('nope');
    }
  });
}
let bridgePort = 0;
let context: BrowserContext;
let sw: Worker;
let userDataDir = '';
const clients: Client[] = [];

async function newClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { SCRAPELINE_PORT: String(bridgePort), SCRAPELINE_EXPORT_DIR: exportDir },
    stderr: 'ignore',
  });
  const c = new Client({ name: 'e2e', version: '0.0.0' });
  await c.connect(transport);
  clients.push(c);
  return c;
}

async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await c.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { text: r.content.map((x) => x.text).join('\n'), isError: !!r.isError };
}

const setStorage = (v: Record<string, unknown>) => sw.evaluate((x) => chrome.storage.local.set(x), v);

async function tabIdFor(c: Client, urlPart: string): Promise<number> {
  const { text } = await call(c, 'list_tabs');
  const line = text.split('\n').find((l) => l.includes(urlPart));
  if (!line) throw new Error(`no tab with ${urlPart} in:\n${text}`);
  return Number(line.split('\t')[0].replace('*', ''));
}

let client: Client;
let shop: Page;

test.beforeAll(async () => {
  web2 = fixtureServer();
  await new Promise<void>((r) => web2.listen(0, '127.0.0.1', r));
  base2 = `http://localhost:${(web2.address() as { port: number }).port}`;
  web = fixtureServer();
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(web.address() as { port: number }).port}`;

  exportDir = mkdtempSync(join(tmpdir(), 'scrapeline-exports-'));
  bridgePort = await freePort();
  client = await newClient();

  userDataDir = mkdtempSync(join(tmpdir(), 'scrapeline-e2e-'));
  const preparedExt = prepareExtension(bridgePort);
  context = await chromium.launchPersistentContext(userDataDir, {
    // On this Windows setup the default ms-playwright install location fails SxS activation,
    // so a copy under .browsers/ (or SCRAPELINE_CHROMIUM) is preferred when present.
    ...(process.env.SCRAPELINE_CHROMIUM ? { executablePath: chromiumExe } : { channel: browserChannel }),
    headless: true,
    args: [`--disable-extensions-except=${preparedExt}`, `--load-extension=${preparedExt}`],
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await setStorage({ port: bridgePort, enabled: true, blocklist: [] });

  await expect
    .poll(async () => (await call(client, 'browser_status')).text, { timeout: 20_000 })
    .toContain('extensionConnected=true');

  shop = await context.newPage();
  await shop.goto(`${base}/shop.html`);
});

test.afterAll(async () => {
  for (const c of clients) await c.close().catch(() => {});
  await context?.close().catch(() => {});
  await new Promise<void>((r) => web?.close(() => r()));
  await new Promise<void>((r) => web2?.close(() => r()));
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  if (exportDir) rmSync(exportDir, { recursive: true, force: true });
});

test('browser_status reports the extension over the bridge', async () => {
  const { text } = await call(client, 'browser_status');
  expect(text).toMatch(/bridge=hub/);
  expect(text).toContain('extensionConnected=true');
  expect(text).toContain('"enabled":true');
});

test('list_tabs shows the shop tab and marks restricted ones', async () => {
  const { text } = await call(client, 'list_tabs');
  expect(text).toContain(`${base}/shop.html`);
  expect(text).toContain('(restricted)'); // the initial about:blank tab
});

test('page_info is tiny and accurate', async () => {
  const id = await tabIdFor(client, '/shop.html');
  const { text, isError } = await call(client, 'page_info', { tabId: id });
  expect(isError).toBe(false);
  expect(text).toContain('title: Acme Shop — Widgets');
  expect(text).toContain('tables=1');
  expect(text.length).toBeLessThan(600);
});

test('page_outline exposes structure and extraction hints', async () => {
  const id = await tabIdFor(client, '/shop.html');
  const { text } = await call(client, 'page_outline', { tabId: id });
  expect(text).toContain('## Headings');
  expect(text).toContain('repeating list: 4 rows');
  expect(text).toContain('"Load more"');
  expect(text.length).toBeLessThan(2500);
});

test('page_text returns main content only, without hidden or boilerplate text', async () => {
  const id = await tabIdFor(client, '/shop.html');
  const { text } = await call(client, 'page_text', { tabId: id, maxChars: 3000 });
  expect(text).toContain('Blue Widget');
  expect(text).not.toContain('SECRET PROMO');
  expect(text).not.toContain('Copyright Acme');
});

test('page_text pages through long content with offset', async () => {
  const art = await context.newPage();
  await art.goto(`${base}/article.html`);
  const id = await tabIdFor(client, '/article.html');
  const first = await call(client, 'page_text', { tabId: id, maxChars: 150 });
  expect(first.text).toContain('offset=');
  expect(first.text).not.toContain('Sidebar');
  expect(first.text).not.toContain('Footer boilerplate');
  const off = Number(/offset=(\d+)/.exec(first.text)![1]);
  const second = await call(client, 'page_text', { tabId: id, maxChars: 150, offset: off });
  expect(second.text).not.toBe(first.text);
  await art.close();
});

test('page_extract auto finds the product grid as TSV', async () => {
  const id = await tabIdFor(client, '/shop.html');
  const { text } = await call(client, 'page_extract', { tabId: id });
  const lines = text.split('\n');
  const header = lines.find((l) => l.includes('title_url'))!;
  expect(header).toBeTruthy();
  expect(text).toMatch(/Blue Widget\t.*\/p\/1\t\$10\.00/);
  expect(text).toContain('Sold out');
  expect(text).toContain('[4 of 4 rows; list;');
  expect(text).toContain('other candidates: table 3 rows');
});

test('page_extract fields mode and json format', async () => {
  const id = await tabIdFor(client, '/shop.html');
  const { text } = await call(client, 'page_extract', {
    tabId: id,
    mode: 'fields',
    rowSelector: '.card',
    fields: { name: { selector: '.title' }, price: { selector: '.price' } },
    format: 'json',
    limit: 2,
  });
  expect(text).toContain('[{"name":"Blue Widget","price":"$10.00"},{"name":"Red Widget","price":"$12.50"}]');
  expect(text).toContain('[2 of 4 rows');
});

test('page_query with refs from the outline', async () => {
  const id = await tabIdFor(client, '/shop.html');
  const outline = (await call(client, 'page_outline', { tabId: id })).text;
  const ref = /h1 \[(e\d+)\] Widgets/.exec(outline)![1];
  const { text } = await call(client, 'page_query', { tabId: id, ref });
  expect(text).toContain(`[${ref}] <h1> Widgets`);
  const links = await call(client, 'page_query', { tabId: id, selector: '.card a', attrs: ['href'], limit: 2 });
  expect(links.text).toContain('href=' + base + '/p/1');
  expect(links.text).toContain('[2 of 4 matches; truncated]');
});

test('page content is framed as untrusted (prompt-injection page)', async () => {
  const p = await context.newPage();
  await p.goto(`${base}/injection.html`);
  const id = await tabIdFor(client, '/injection.html');
  const { text } = await call(client, 'page_text', { tabId: id });
  expect(text.split('\n')[0]).toContain('untrusted page content');
  expect(text).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS'); // delivered as data, never acted on
  await p.close();
});

test('open_url opens a background tab and the new tab is readable', async () => {
  const before = await shop.evaluate(() => document.visibilityState);
  const { text, isError } = await call(client, 'open_url', { url: `${base}/article.html` });
  expect(isError).toBe(false);
  const { tabId, title } = JSON.parse(text);
  expect(title).toBe('How Widgets Are Made');
  expect(await shop.evaluate(() => document.visibilityState)).toBe(before);
  const info = await call(client, 'page_info', { tabId });
  expect(info.text).toContain('How Widgets Are Made');
  await sw.evaluate((id) => chrome.tabs.remove(id), tabId);
});

test('open_url refuses non-http schemes', async () => {
  const r = await call(client, 'open_url', { url: 'file:///etc/passwd' });
  expect(r.isError).toBe(true);
  expect(r.text).toMatch(/BLOCKED/);
});

test('restricted tabs (about:blank) cannot be read', async () => {
  const { text } = await call(client, 'list_tabs');
  const restricted = text.split('\n').find((l) => l.includes('(restricted)'))!;
  const id = Number(restricted.split('\t')[0].replace('*', ''));
  const r = await call(client, 'page_info', { tabId: id });
  expect(r.isError).toBe(true);
  expect(r.text).toContain('BLOCKED');
});

test('block list stops reads for that host', async () => {
  const id = await tabIdFor(client, '/shop.html'); // resolve first: blocked tabs are masked in list_tabs
  await setStorage({ blocklist: ['127.0.0.1'] });
  const r = await call(client, 'page_info', { tabId: id });
  const listed = (await call(client, 'list_tabs')).text;
  await setStorage({ blocklist: [] });
  expect(r.isError).toBe(true);
  expect(r.text).toMatch(/BLOCKED/);
  expect(listed).not.toContain('/shop.html');
});

test('kill switch disables reads but status still answers', async () => {
  const id = await tabIdFor(client, '/shop.html');
  await setStorage({ enabled: false });
  const r = await call(client, 'page_info', { tabId: id });
  const status = await call(client, 'browser_status');
  await setStorage({ enabled: true });
  expect(r.isError).toBe(true);
  expect(r.text).toContain('DISABLED');
  expect(status.text).toContain('"enabled":false');
  const again = await call(client, 'page_info', { tabId: id });
  expect(again.isError).toBe(false);
});

test('audit log records calls without page content', async () => {
  const log = await sw.evaluate(async () => (await chrome.storage.local.get('audit')).audit as Array<Record<string, unknown>>);
  const summary = log.map((e) => `${e.method}:${e.ok}`).join(' ');
  expect(log.length, summary).toBeGreaterThan(5);
  expect(log.some((e) => e.method === 'page_extract' && e.ok === true), summary).toBe(true);
  expect(JSON.stringify(log)).not.toContain('Blue Widget');
});

test('page_scroll reports position', async () => {
  const id = await tabIdFor(client, '/shop.html');
  const r = await call(client, 'page_scroll', { tabId: id, direction: 'bottom' });
  expect(r.isError).toBe(false);
  const j = JSON.parse(r.text);
  expect(j).toHaveProperty('atBottom');
});

// ------------------------------------------------------------ iframes / shadow DOM / export

async function frameIdOf(tab: number): Promise<number> {
  const { text } = await call(client, 'page_outline', { tabId: tab });
  const m = /frame (\d+): localhost\S* 600x300/.exec(text);
  if (!m) throw new Error(`no frame listed in outline:\n${text}`);
  return Number(m[1]);
}

test('page_outline lists real sub-frames (and skips tiny tracking frames)', async () => {
  const p = await context.newPage();
  await p.goto(`${base}/frames.html`);
  await p.frameLocator('iframe[title=inventory]').locator('.row').first().waitFor();
  const id = await tabIdFor(client, '/frames.html');
  const { text } = await call(client, 'page_outline', { tabId: id });
  expect(text).toContain('## Frames');
  expect(text).toMatch(/frame \d+: localhost:\d+\/frame-content\.html 600x300/);
  expect(text.match(/frame \d+:/g)).toHaveLength(1); // the 1x1 srcdoc frame is filtered out
  await p.close();
});

test('frameId reads inside a cross-origin iframe; the top frame does not see it', async () => {
  const p = await context.newPage();
  await p.goto(`${base}/frames.html`);
  await p.frameLocator('iframe[title=inventory]').locator('.row').first().waitFor();
  const tab = await tabIdFor(client, '/frames.html');
  const frameId = await frameIdOf(tab);

  const top = await call(client, 'page_text', { tabId: tab, maxChars: 3000 });
  expect(top.text).toContain('Frame host page');
  expect(top.text).not.toContain('SKU-A1');

  const inner = await call(client, 'page_text', { tabId: tab, frameId, maxChars: 3000 });
  expect(inner.text).toContain('Warehouse stock');
  expect(inner.text).toContain('SKU-B2');

  const rows = await call(client, 'page_extract', { tabId: tab, frameId });
  expect(rows.text).toMatch(/SKU-A1\t5 units\tNorth bay\t.*\/loc\/north/);
  expect(rows.text).toContain('[4 of 4 rows');

  const bad = await call(client, 'page_text', { tabId: tab, frameId: 9999 });
  expect(bad.isError).toBe(true);
  expect(bad.text).toContain('NO_TAB');
  await p.close();
});

test('block list also covers frames', async () => {
  const p = await context.newPage();
  await p.goto(`${base}/frames.html`);
  await p.frameLocator('iframe[title=inventory]').locator('.row').first().waitFor();
  const tab = await tabIdFor(client, '/frames.html');
  const frameId = await frameIdOf(tab);
  await setStorage({ blocklist: ['localhost'] }); // the frame's host, not the top page's (127.0.0.1)
  const outline = await call(client, 'page_outline', { tabId: tab });
  const read = await call(client, 'page_text', { tabId: tab, frameId });
  await setStorage({ blocklist: [] });
  expect(outline.text).not.toContain('## Frames');
  expect(read.isError).toBe(true);
  expect(read.text).toContain('BLOCKED');
  await p.close();
});

test('open shadow roots are readable and extractable in real Chromium', async () => {
  const p = await context.newPage();
  await p.goto(`${base}/shadow.html`);
  const tab = await tabIdFor(client, '/shadow.html');
  const text = await call(client, 'page_text', { tabId: tab, maxChars: 3000 });
  expect(text.text).toContain('Desk');
  expect(text.text).toContain('$150');
  const ex = await call(client, 'page_extract', { tabId: tab });
  expect(ex.text).toMatch(/Chair\t\$85/);
  expect(ex.text).toContain('[4 of 4 rows');
  // the reported rowSelector is reusable in fields mode across the shadow boundary
  const sel = /rowSelector="((?:[^"\\]|\\.)*)"/.exec(ex.text)![1].replace(/\\"/g, '"');
  const fields = await call(client, 'page_extract', {
    tabId: tab,
    mode: 'fields',
    rowSelector: sel,
    fields: { name: { selector: '.pname' }, price: { selector: '.pprice' } },
    format: 'json',
  });
  expect(fields.text).toContain('{"name":"Lamp","price":"$20"}');
  await p.close();
});

test('saveAs writes every row to a file and returns only a path plus a tiny preview', async () => {
  const tab = await tabIdFor(client, '/shop.html');
  const r = await call(client, 'page_extract', { tabId: tab, saveAs: 'csv', filename: 'shop products' });
  expect(r.isError, r.text).toBe(false);
  const m = /saved 4 of 4 rows x (\d+) cols to (.+\.csv) \(csv/.exec(r.text)!;
  expect(m).toBeTruthy();
  const file = m[2];
  expect(file.startsWith(exportDir)).toBe(true);
  const csv = readFileSync(file, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv.split('\r\n').filter(Boolean)).toHaveLength(5); // header + 4 rows
  expect(csv).toContain('Blue Widget');
  expect(csv).toContain('Gold Widget');
  expect(r.text.length).toBeLessThan(900); // cost stays flat however many rows were saved

  const again = await call(client, 'page_extract', { tabId: tab, saveAs: 'csv', filename: 'shop products' });
  expect(again.text).toContain('shop-products-1.csv'); // never overwrites
});

test('a traversal-y filename cannot escape the export directory', async () => {
  const tab = await tabIdFor(client, '/shop.html');
  const r = await call(client, 'page_extract', { tabId: tab, saveAs: 'json', filename: '../../../evil' });
  expect(r.isError).toBe(false);
  const file = /to (.+\.json) \(json/.exec(r.text)![1];
  expect(file.startsWith(exportDir)).toBe(true);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(4);
});

test('more than 500 rows requires saveAs', async () => {
  const tab = await tabIdFor(client, '/shop.html');
  const r = await call(client, 'page_extract', { tabId: tab, limit: 1000 });
  expect(r.isError).toBe(true);
  expect(r.text).toContain('requires saveAs');
});

test('a second MCP client relays through the hub (multiple Claude sessions)', async () => {
  const second = await newClient();
  await expect
    .poll(async () => (await call(second, 'browser_status')).text, { timeout: 10_000 })
    .toMatch(/bridge=relay.*extensionConnected=true/);
  const id = await tabIdFor(second, '/shop.html');
  const r = await call(second, 'page_extract', { tabId: id, limit: 1 });
  expect(r.text).toContain('Blue Widget');
});

const status = (c: Client) => async () => (await call(c, 'browser_status')).text;

test('when the hub session ends, another session takes over and the extension reconnects', async () => {
  const standby = await newClient(); // becomes a relay while `client` is the hub
  await expect.poll(status(standby), { timeout: 10_000 }).toContain('bridge=relay');
  await client.close(); // the hub process exits
  // Other standby sessions may exist (test above), so either survivor can win the election;
  // what matters is that one becomes the hub and the extension reconnects to it.
  await expect
    .poll(status(standby), { timeout: 30_000, intervals: [500, 1000, 2000] })
    .toMatch(/bridge=(hub|relay).*extensionConnected=true/);
  const modes = await Promise.all(clients.slice(1).map(async (c) => (await call(c, 'browser_status')).text));
  expect(modes.filter((m) => m.includes('bridge=hub'))).toHaveLength(1); // exactly one new hub
  client = standby;
  const id = await tabIdFor(client, '/shop.html');
  expect((await call(client, 'page_info', { tabId: id })).isError).toBe(false);
});

test('extension recovers after its service worker is killed', async () => {
  test.setTimeout(120_000);
  const cdp = await context.newCDPSession(shop);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  // The stop must be observable, otherwise this test proves nothing.
  await expect.poll(status(client), { timeout: 15_000, intervals: [250, 500, 1000] }).toContain('extensionConnected=false');
  // chrome.alarms (30 s period) wakes the worker, which reconnects.
  await expect.poll(status(client), { timeout: 75_000, intervals: [1000, 2000, 3000] }).toContain('extensionConnected=true');
  const id = await tabIdFor(client, '/shop.html');
  const r = await call(client, 'page_info', { tabId: id });
  expect(r.isError, r.text).toBe(false);
});
