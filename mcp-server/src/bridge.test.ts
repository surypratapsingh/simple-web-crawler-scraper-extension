import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ErrorCodes, type Req } from '../../packages/protocol/src/index';
import { Bridge } from './bridge';
import { fmtExtract, fmtTabs, fmtText, tsv, UNTRUSTED } from './format';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

const open = (ws: WebSocket) => new Promise<void>((r) => ws.once('open', () => r()));
const waitFor = async (cond: () => boolean | Promise<boolean>, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('waitFor timed out');
};

/** A fake browser extension: answers requests via a handler. */
async function fakeExt(port: number, handler: (r: Req) => unknown, opts: { token?: string; origin?: string } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, opts.origin ? { origin: opts.origin } : undefined);
  await open(ws);
  ws.send(JSON.stringify({ type: 'hello', role: 'ext', version: 'test', token: opts.token }));
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type !== 'req') return;
    try {
      const result = handler(m);
      ws.send(JSON.stringify({ type: 'res', id: m.id, ok: true, result }));
    } catch (e) {
      ws.send(JSON.stringify({ type: 'res', id: m.id, ok: false, error: { code: 'INTERNAL', message: (e as Error).message } }));
    }
  });
  return ws;
}

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe('Bridge', () => {
  it('first instance becomes hub and round-trips a call to the extension', async () => {
    const port = await freePort();
    const b = new Bridge({ port });
    cleanup.push(() => b.close());
    expect(await b.start()).toBe('hub');
    const ext = await fakeExt(port, (r) => ({ echo: r.method, params: r.params }));
    cleanup.push(() => ext.terminate());
    await waitFor(async () => (await b.info()).extensionConnected);
    expect(await b.call('page_info', { tabId: 3 })).toEqual({ echo: 'page_info', params: { tabId: 3 } });
  });

  it('reports EXT_NOT_CONNECTED when no extension is attached', async () => {
    const port = await freePort();
    const b = new Bridge({ port });
    cleanup.push(() => b.close());
    await b.start();
    await expect(b.call('list_tabs')).rejects.toMatchObject({ code: ErrorCodes.EXT_NOT_CONNECTED });
  });

  it('propagates extension errors with their code', async () => {
    const port = await freePort();
    const b = new Bridge({ port });
    cleanup.push(() => b.close());
    await b.start();
    const ext = await fakeExt(port, () => {
      throw new Error('boom');
    });
    cleanup.push(() => ext.terminate());
    await waitFor(async () => (await b.info()).extensionConnected);
    await expect(b.call('x')).rejects.toThrow('boom');
  });

  it('times out when the extension never answers', async () => {
    const port = await freePort();
    const b = new Bridge({ port });
    cleanup.push(() => b.close());
    await b.start();
    const ext = new WebSocket(`ws://127.0.0.1:${port}`);
    await open(ext);
    ext.send(JSON.stringify({ type: 'hello', role: 'ext' }));
    cleanup.push(() => ext.terminate());
    await waitFor(async () => (await b.info()).extensionConnected);
    await expect(b.call('slow', {}, 150)).rejects.toMatchObject({ code: ErrorCodes.TIMEOUT });
  });

  it('a second instance relays through the hub', async () => {
    const port = await freePort();
    const hub = new Bridge({ port });
    const relay = new Bridge({ port });
    cleanup.push(() => relay.close(), () => hub.close());
    expect(await hub.start()).toBe('hub');
    expect(await relay.start()).toBe('relay');
    const ext = await fakeExt(port, (r) => `hello ${r.method}`);
    cleanup.push(() => ext.terminate());
    await waitFor(async () => (await relay.info()).extensionConnected);
    expect(await relay.call('list_tabs')).toBe('hello list_tabs');
    expect(await hub.call('list_tabs')).toBe('hello list_tabs');
  });

  it('a relay promotes itself when the hub goes away', async () => {
    const port = await freePort();
    const hub = new Bridge({ port });
    const relay = new Bridge({ port });
    cleanup.push(() => relay.close());
    await hub.start();
    await relay.start();
    await hub.close();
    await waitFor(() => relay.mode === 'hub', 5000);
    const ext = await fakeExt(port, () => 'ok');
    cleanup.push(() => ext.terminate());
    await waitFor(async () => (await relay.info()).extensionConnected);
    expect(await relay.call('anything')).toBe('ok');
  });

  it('rejects browser connections from web-page origins', async () => {
    const port = await freePort();
    const b = new Bridge({ port });
    cleanup.push(() => b.close());
    await b.start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'https://evil.example' });
    const err = await new Promise<Error>((r) => ws.once('error', r));
    expect(String(err.message)).toMatch(/401|Unexpected server response/);
  });

  it('accepts extension origins and enforces the token and pinned id', async () => {
    const port = await freePort();
    const b = new Bridge({ port, token: 's3cret', extensionId: 'abcdef' });
    cleanup.push(() => b.close());
    await b.start();
    const wrongId = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'chrome-extension://zzzzzz' });
    await new Promise<void>((r) => wrongId.once('error', () => r()));

    const badToken = await fakeExt(port, () => 1, { origin: 'chrome-extension://abcdef', token: 'nope' });
    await new Promise<void>((r) => badToken.once('close', () => r()));
    expect((await b.info()).extensionConnected).toBe(false);

    const good = await fakeExt(port, () => 'fine', { origin: 'chrome-extension://abcdef', token: 's3cret' });
    cleanup.push(() => good.terminate());
    await waitFor(async () => (await b.info()).extensionConnected);
    expect(await b.call('x')).toBe('fine');
  });
});

describe('format', () => {
  it('tsv strips tabs and newlines from cells', () => {
    expect(tsv(['a', 'b'], [['x\ty', 'z\nw']])).toBe('a\tb\nx y\tz w');
  });

  it('fmtExtract labels untrusted content and reports row counts', () => {
    const out = fmtExtract({ kind: 'list', rowSelector: '.card', columns: ['n'], rows: [['1'], ['2']], total: 9 }, 'tsv');
    expect(out.startsWith(UNTRUSTED)).toBe(true);
    expect(out).toContain('[2 of 9 rows');
  });

  it('fmtExtract json shape', () => {
    const out = fmtExtract({ kind: 'table', rowSelector: 't tr', columns: ['a', 'b'], rows: [['1', '2']], total: 1 }, 'json');
    expect(out).toContain('[{"a":"1","b":"2"}]');
  });

  it('fmtText tells the model how to continue', () => {
    const out = fmtText({ text: 'abc', total: 10, offset: 0, truncated: true, nextOffset: 3, root: 'body' });
    expect(out).toContain('offset=3');
  });

  it('fmtTabs marks active tabs', () => {
    expect(fmtTabs([{ id: 1, active: true, title: 'A', url: 'https://a' }])).toContain('1*\tA\thttps://a');
  });
});
