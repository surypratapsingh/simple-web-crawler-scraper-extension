import { readFileSync } from 'node:fs';
import { call } from './harness';

export interface Parsed {
  text: string;
  isError: boolean;
  id: string;
  state: string;
  reason: string;
  pages: number;
  rows: number;
  file?: string;
}

export function parse(r: { text: string; isError: boolean }): Parsed {
  const m = /crawl (\w+): (running|finished)(?: \((\w+)\))?: (\d+) pages, (\d+) rows/.exec(r.text);
  return {
    ...r,
    id: m?.[1] ?? '',
    state: m?.[2] ?? '',
    reason: m?.[3] ?? '',
    pages: Number(m?.[4] ?? -1),
    rows: Number(m?.[5] ?? -1),
    file: /saved: (.+?\.(?:csv|json|ndjson))/.exec(r.text)?.[1],
  };
}

export const crawl = async (args: Record<string, unknown>) =>
  parse(await call('crawl_start', { waitSec: 25, delayMs: 500, ...args }));

export const tabIds = async () =>
  (await call('list_tabs')).text
    .split('\n')
    .slice(1)
    .map((l) => l.split('\t')[0].replace('*', ''))
    .sort();

export const csvRows = (file: string) => readFileSync(file, 'utf8').split('\r\n').filter(Boolean).slice(1);

