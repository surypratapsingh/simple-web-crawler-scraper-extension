import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dynamicRoute } from './site';

// Shared real-browser harness: fixture servers (two origins), a real MCP client over stdio
// against the built server, and Chromium with the built extension loaded.

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

export const env = {
  base: '',
  base2: '',
  exportDir: '',
  downloadsDir: '',
  recipesDir: '',
  bridgePort: 0,
  context: undefined as unknown as BrowserContext,
  sw: undefined as unknown as Worker,
  client: undefined as unknown as Client,
};

const servers: http.Server[] = [];
const clients: Client[] = [];
let userDataDir = '';
let extDir = '';

export const freePort = () =>
  new Promise<number>((res) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

function fixtureServer(): http.Server {
  const s = http.createServer((req, res) => {
    const dyn = dynamicRoute(req.url ?? '/', { other: env.base2, base: env.base });
    if (dyn) {
      res.writeHead(dyn.status, { 'content-type': dyn.type });
      return void res.end(dyn.body);
    }
    const name = (req.url ?? '/').split('?')[0].replace(/^\//, '') || 'shop.html';
    try {
      const body = readFileSync(join(fixtures, name), 'utf8').replaceAll('{{OTHER}}', env.base2);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404).end('nope');
    }
  });
  servers.push(s);
  return s;
}


/**
 * Copy the built extension to a temp dir and make the test bridge port its *default* port, so a
 * fresh profile never talks to port 8765 (a developer's real hub). Returns the directory.
 */
export function prepareExtension(port: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'scrapeline-ext-'));
  cpSync(extPath, dir, { recursive: true });
  const bg = join(dir, 'background.js');
  const src = readFileSync(bg, 'utf8');
  if (!src.includes('8765')) throw new Error('default port constant not found in background.js');
  writeFileSync(bg, src.split('8765').join(String(port)));
  return dir;
}

export async function newClient(port = env.bridgePort): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      SCRAPELINE_PORT: String(port),
      SCRAPELINE_EXPORT_DIR: env.exportDir,
      SCRAPELINE_DOWNLOADS_DIR: env.downloadsDir,
      SCRAPELINE_RECIPES_DIR: env.recipesDir,
    },
    stderr: 'ignore',
  });
  const c = new Client({ name: 'e2e', version: '0.0.0' });
  await c.connect(transport);
  clients.push(c);
  return c;
}

export async function call(name: string, args: Record<string, unknown> = {}, c: Client = env.client) {
  const r = (await c.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { text: r.content.map((x) => x.text).join('\n'), isError: !!r.isError };
}

export const setStorage = (v: Record<string, unknown>) => env.sw.evaluate((x) => chrome.storage.local.set(x), v);

export async function up() {
  const s2 = fixtureServer();
  await new Promise<void>((r) => s2.listen(0, '127.0.0.1', r));
  env.base2 = `http://localhost:${(s2.address() as { port: number }).port}`;
  const s1 = fixtureServer();
  await new Promise<void>((r) => s1.listen(0, '127.0.0.1', r));
  env.base = `http://127.0.0.1:${(s1.address() as { port: number }).port}`;

  env.exportDir = mkdtempSync(join(tmpdir(), 'scrapeline-exports-'));
  env.downloadsDir = mkdtempSync(join(tmpdir(), 'scrapeline-downloads-'));
  env.recipesDir = mkdtempSync(join(tmpdir(), 'scrapeline-recipes-'));
  env.bridgePort = await freePort();
  env.client = await newClient();

  userDataDir = mkdtempSync(join(tmpdir(), 'scrapeline-e2e-'));
  extDir = prepareExtension(env.bridgePort);
  env.context = await chromium.launchPersistentContext(userDataDir, {
    ...(process.env.SCRAPELINE_CHROMIUM ? { executablePath: chromiumExe } : { channel: browserChannel }),
    headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  env.sw = env.context.serviceWorkers()[0] ?? (await env.context.waitForEvent('serviceworker'));
  await setStorage({ port: env.bridgePort, enabled: true, blocklist: [] });

  const deadline = Date.now() + 20_000;
  for (;;) {
    if ((await call('browser_status')).text.includes('extensionConnected=true')) break;
    if (Date.now() > deadline) {
      const st = (await call('browser_status')).text;
      const stored = await env.sw.evaluate(() => chrome.storage.local.get(['port', 'enabled'])).catch((e) => String(e));
      const probe = await env.sw
        .evaluate(async (port) => {
          const one = (p: number) =>
            new Promise<string>((r) => {
              try {
                const w = new WebSocket(`ws://127.0.0.1:${p}`);
                w.onopen = () => (r('open'), w.close());
                w.onerror = () => r('error');
                setTimeout(() => r('timeout'), 3000);
              } catch (e) {
                r('throw ' + e);
              }
            });
          return { testPort: await one(port), defaultPort: await one(8765), alarms: (await chrome.alarms.getAll()).length };
        }, env.bridgePort)
        .catch((e) => String(e));
      throw new Error(
        `extension never connected to the bridge: status="${st}" stored=${JSON.stringify(stored)} expectedPort=${env.bridgePort} probe=${JSON.stringify(probe)} swUrl=${env.sw.url()}`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function down() {
  for (const c of clients) await c.close().catch(() => {});
  await env.context?.close().catch(() => {});
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  if (extDir) rmSync(extDir, { recursive: true, force: true });
  if (env.exportDir) rmSync(env.exportDir, { recursive: true, force: true });
  if (env.downloadsDir) rmSync(env.downloadsDir, { recursive: true, force: true });
  if (env.recipesDir) rmSync(env.recipesDir, { recursive: true, force: true });
}
