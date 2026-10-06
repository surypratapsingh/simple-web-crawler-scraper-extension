import { WebSocket, WebSocketServer } from 'ws';
import { BridgeError, ErrorCodes, HOST, type Msg, type Req, type Res } from '../../packages/protocol/src/index';

export interface BridgeOptions {
  port: number;
  token?: string;
  /** If set, only this chrome-extension:// origin may connect from a browser. */
  extensionId?: string;
  log?: (msg: string) => void;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

type Mode = 'starting' | 'hub' | 'relay' | 'down';

const PING_MS = 20_000;

/**
 * Connects an MCP server process to the browser extension.
 *
 * The first process to bind the port becomes the **hub** (the extension connects to it).
 * Any later process (e.g. a second Claude session) connects to the hub as a **relay**
 * and its calls are forwarded to the extension. If the hub goes away, a relay
 * promotes itself, and the extension's reconnect loop finds the new hub.
 */
export class Bridge {
  mode: Mode = 'starting';
  private opts: BridgeOptions;
  private wss?: WebSocketServer;
  private ext?: WebSocket;
  private extVersion?: string;
  private relayWs?: WebSocket;
  private pending = new Map<string, Pending>();
  private forwarded = new Map<string, { client: WebSocket; clientId: string }>();
  private seq = 0;
  private closed = false;
  private pingTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;

  constructor(opts: BridgeOptions) {
    this.opts = opts;
  }

  private log(m: string) {
    this.opts.log?.(`[bridge:${this.mode}] ${m}`);
  }

  async start(): Promise<Mode> {
    if (this.closed) return this.mode;
    try {
      await this.tryHub();
      this.mode = 'hub';
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        this.mode = 'down';
        this.log(`hub failed: ${(e as Error).message}`);
        this.scheduleRetry();
        return this.mode;
      }
      try {
        await this.tryRelay();
        this.mode = 'relay';
      } catch (e2) {
        this.mode = 'down';
        this.log(`relay failed: ${(e2 as Error).message}`);
        this.scheduleRetry();
      }
    }
    this.log('ready');
    return this.mode;
  }

  private scheduleRetry() {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.start(), 300 + Math.random() * 500);
  }

  // ------------------------------------------------------------------ hub

  private tryHub(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: HOST,
        port: this.opts.port,
        verifyClient: (info: { origin: string }) => this.originOk(info.origin),
      });
      const onErr = (e: Error) => {
        wss.close();
        reject(e);
      };
      wss.once('error', onErr);
      wss.once('listening', () => {
        wss.off('error', onErr);
        wss.on('error', (e) => this.log(`wss error: ${e.message}`));
        this.wss = wss;
        wss.on('connection', (ws) => this.onConnection(ws));
        this.pingTimer = setInterval(() => {
          if (this.ext?.readyState === WebSocket.OPEN) this.ext.send(JSON.stringify({ type: 'ping' }));
        }, PING_MS);
        resolve();
      });
    });
  }

  private originOk(origin: string | undefined): boolean {
    if (!origin) return true; // non-browser local client (Node relay, tests)
    const isExt = /^(chrome|moz)-extension:\/\//.test(origin);
    if (!isExt) return false; // blocks web pages (cross-site WebSocket hijacking)
    return !this.opts.extensionId || origin.endsWith('//' + this.opts.extensionId);
  }

  private onConnection(ws: WebSocket) {
    const timer = setTimeout(() => ws.close(4002, 'hello timeout'), 3000);
    ws.once('message', (raw) => {
      clearTimeout(timer);
      let hello: Msg;
      try {
        hello = JSON.parse(String(raw));
      } catch {
        return ws.close(4003, 'bad hello');
      }
      if (hello.type !== 'hello') return ws.close(4003, 'expected hello');
      if (this.opts.token && hello.token !== this.opts.token) return ws.close(4001, 'bad token');
      if (hello.role === 'ext') this.attachExt(ws, hello.version);
      else this.attachRelayClient(ws);
    });
  }

  private attachExt(ws: WebSocket, version?: string) {
    if (this.ext && this.ext !== ws) this.ext.close(4000, 'replaced');
    this.ext = ws;
    this.extVersion = version;
    this.log(`extension connected (v${version ?? '?'})`);
    ws.on('message', (raw) => {
      let m: Msg;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.type === 'res') this.onExtResponse(m);
    });
    ws.on('close', () => {
      if (this.ext !== ws) return;
      this.ext = undefined;
      this.log('extension disconnected');
      this.failAll(new BridgeError(ErrorCodes.EXT_NOT_CONNECTED, 'browser extension disconnected'));
    });
    ws.send(JSON.stringify({ type: 'hello', role: 'mcp' }));
  }

  private onExtResponse(res: Res) {
    const fwd = this.forwarded.get(res.id);
    if (fwd) {
      this.forwarded.delete(res.id);
      if (fwd.client.readyState === WebSocket.OPEN) fwd.client.send(JSON.stringify({ ...res, id: fwd.clientId }));
      return;
    }
    this.settle(res);
  }

  private attachRelayClient(ws: WebSocket) {
    ws.on('message', (raw) => {
      let m: Msg;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.type !== 'req') return;
      if (m.method === '_hub') {
        const res: Res = { type: 'res', id: m.id, ok: true, result: this.hubInfo() };
        return void ws.send(JSON.stringify(res));
      }
      if (this.ext?.readyState !== WebSocket.OPEN) {
        const res: Res = {
          type: 'res',
          id: m.id,
          ok: false,
          error: { code: ErrorCodes.EXT_NOT_CONNECTED, message: 'browser extension is not connected' },
        };
        return void ws.send(JSON.stringify(res));
      }
      const hubId = `f${++this.seq}`;
      this.forwarded.set(hubId, { client: ws, clientId: m.id });
      this.ext.send(JSON.stringify({ ...m, id: hubId }));
    });
    ws.on('close', () => {
      for (const [k, v] of this.forwarded) if (v.client === ws) this.forwarded.delete(k);
    });
  }

  private hubInfo() {
    return { extensionConnected: this.ext?.readyState === WebSocket.OPEN, extensionVersion: this.extVersion };
  }

  // ---------------------------------------------------------------- relay

  private tryRelay(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${HOST}:${this.opts.port}`);
      const fail = (e: Error) => {
        ws.terminate();
        reject(e);
      };
      ws.once('error', fail);
      ws.once('open', () => {
        ws.off('error', fail);
        ws.send(JSON.stringify({ type: 'hello', role: 'mcp', token: this.opts.token }));
        this.relayWs = ws;
        ws.on('message', (raw) => {
          try {
            const m = JSON.parse(String(raw)) as Msg;
            if (m.type === 'res') this.settle(m);
          } catch {
            /* ignore */
          }
        });
        ws.on('close', () => {
          if (this.relayWs !== ws) return;
          this.relayWs = undefined;
          this.mode = 'starting';
          this.log('hub connection lost; re-electing');
          this.failAll(new BridgeError(ErrorCodes.EXT_NOT_CONNECTED, 'lost connection to bridge hub'));
          this.scheduleRetry();
        });
        resolve();
      });
    });
  }

  // ---------------------------------------------------------------- calls

  private settle(res: Res) {
    const p = this.pending.get(res.id);
    if (!p) return;
    this.pending.delete(res.id);
    clearTimeout(p.timer);
    if (res.ok) p.resolve(res.result);
    else p.reject(new BridgeError(res.error?.code ?? ErrorCodes.INTERNAL, res.error?.message ?? 'unknown error'));
  }

  private failAll(err: Error) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
    for (const [hubId, f] of this.forwarded) {
      const res: Res = { type: 'res', id: f.clientId, ok: false, error: { code: ErrorCodes.EXT_NOT_CONNECTED, message: err.message } };
      if (f.client.readyState === WebSocket.OPEN) f.client.send(JSON.stringify(res));
      this.forwarded.delete(hubId);
    }
  }

  private send(target: WebSocket, method: string, params: Record<string, unknown> | undefined, timeoutMs: number) {
    const id = `${this.mode === 'hub' ? 'h' : 'r'}${++this.seq}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError(ErrorCodes.TIMEOUT, `no response from browser after ${timeoutMs} ms (${method})`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const req: Req = { type: 'req', id, method, params };
      target.send(JSON.stringify(req));
    });
  }

  /** Call a method implemented by the browser extension. */
  call(method: string, params?: Record<string, unknown>, timeoutMs = 20_000): Promise<unknown> {
    if (this.mode === 'hub') {
      if (this.ext?.readyState !== WebSocket.OPEN) {
        return Promise.reject(
          new BridgeError(
            ErrorCodes.EXT_NOT_CONNECTED,
            'browser extension is not connected. Open Chrome with the Scrapeline extension loaded and enabled.',
          ),
        );
      }
      return this.send(this.ext, method, params, timeoutMs);
    }
    if (this.mode === 'relay' && this.relayWs?.readyState === WebSocket.OPEN) {
      return this.send(this.relayWs, method, params, timeoutMs);
    }
    return Promise.reject(new BridgeError(ErrorCodes.EXT_NOT_CONNECTED, `bridge not ready (mode=${this.mode})`));
  }

  async info(): Promise<{ mode: Mode; port: number; extensionConnected: boolean; extensionVersion?: string }> {
    const base = { mode: this.mode, port: this.opts.port };
    if (this.mode === 'hub') return { ...base, ...this.hubInfo() };
    if (this.mode === 'relay' && this.relayWs?.readyState === WebSocket.OPEN) {
      try {
        const r = (await this.send(this.relayWs, '_hub', undefined, 3000)) as ReturnType<Bridge['hubInfo']>;
        return { ...base, ...r };
      } catch {
        /* fall through */
      }
    }
    return { ...base, extensionConnected: false };
  }

  async close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.retryTimer);
    this.failAll(new BridgeError(ErrorCodes.EXT_NOT_CONNECTED, 'bridge closed'));
    this.relayWs?.terminate();
    this.ext?.terminate();
    for (const c of this.wss?.clients ?? []) c.terminate();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
  }
}
