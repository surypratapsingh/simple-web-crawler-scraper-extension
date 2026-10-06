// Wire protocol shared by the MCP server (hub/relay) and the browser extension.

export const DEFAULT_PORT = 8765;
export const HOST = '127.0.0.1';

export type Role = 'ext' | 'mcp';

export interface Hello {
  type: 'hello';
  role: Role;
  token?: string;
  version?: string;
}
export interface Req {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}
export interface Res {
  type: 'res';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}
export interface Ping {
  type: 'ping';
}
export interface Pong {
  type: 'pong';
}
export type Msg = Hello | Req | Res | Ping | Pong;

/** Methods the extension implements. */
export const METHODS = [
  'status',
  'list_tabs',
  'page_info',
  'page_outline',
  'page_text',
  'page_query',
  'page_extract',
  'page_scroll',
  'open_url',
  'crawl_start',
  'crawl_status',
  'crawl_cancel',
  'crawl_rows',
  'crawl_saved',
  'batch_start',
  'batch_status',
  'batch_cancel',
  'batch_rows',
  'batch_saved',
] as const;
export type Method = (typeof METHODS)[number];

export const ErrorCodes = {
  DISABLED: 'DISABLED',
  BLOCKED: 'BLOCKED',
  NO_TAB: 'NO_TAB',
  BAD_URL: 'BAD_URL',
  BAD_METHOD: 'BAD_METHOD',
  INTERNAL: 'INTERNAL',
  BUSY: 'BUSY',
  BAD_ARGS: 'BAD_ARGS',
  ROBOTS: 'ROBOTS',
  EXT_NOT_CONNECTED: 'EXT_NOT_CONNECTED',
  TIMEOUT: 'TIMEOUT',
} as const;

export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}
