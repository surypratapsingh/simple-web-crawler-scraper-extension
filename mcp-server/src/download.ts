import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';

// "Image Downloader" — actually fetches the bytes (page_extract/find_images only ever return URLs).
// Runs in the MCP server (plain fetch), not through the browser: images are public resources once
// you have their URL, and this avoids needing a chrome.downloads permission in the extension.

export type Fetcher = typeof fetch;

export function downloadsDir(): string {
  return process.env.SCRAPELINE_DOWNLOADS_DIR || join(homedir(), '.scrapeline', 'downloads');
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
};

function nameFor(url: string, index: number, contentType: string, requested?: string): string {
  if (requested) return requested.replace(/[^A-Za-z0-9._ -]+/g, '-').slice(0, 80);
  let base = '';
  try {
    base = decodeURIComponent(basename(new URL(url).pathname)).replace(/[^A-Za-z0-9._-]+/g, '-');
  } catch {
    /* fall through to index-based name */
  }
  const ext = (base && extname(base)) || EXT_BY_TYPE[contentType.split(';')[0].trim()] || '.jpg';
  const stem = (base ? base.slice(0, base.length - extname(base).length) : '') || `image-${String(index + 1).padStart(3, '0')}`;
  return (stem.slice(0, 60) + ext).replace(/^[.-]+/, '');
}

function uniquePath(dir: string, name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let path = join(dir, name);
  for (let i = 1; existsSync(path); i++) path = join(dir, `${stem}-${i}${ext}`);
  return path;
}

export interface DownloadResult {
  dir: string;
  saved: Array<{ url: string; path: string; bytes: number }>;
  skipped: Array<{ url: string; reason: string }>;
}

/** Downloads each URL that looks like an image, skipping the rest with a reason. Never overwrites. */
export async function downloadImages(
  urls: string[],
  opts: { dir?: string; folder?: string; names?: string[]; maxBytes?: number; maxCount?: number; fetcher?: Fetcher } = {},
): Promise<DownloadResult> {
  const fetcher = opts.fetcher ?? fetch;
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024;
  const list = urls.slice(0, Math.min(opts.maxCount ?? 200, 500));
  const dir = join(opts.dir ?? downloadsDir(), (opts.folder ?? 'images').replace(/[^A-Za-z0-9._ -]+/g, '-').slice(0, 60) || 'images');
  mkdirSync(dir, { recursive: true });

  const saved: DownloadResult['saved'] = [];
  const skipped: DownloadResult['skipped'] = [];
  for (let i = 0; i < list.length; i++) {
    const url = list[i];
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        skipped.push({ url, reason: `unsupported scheme ${u.protocol}` });
        continue;
      }
      const res = await fetcher(url);
      if (!res.ok) {
        skipped.push({ url, reason: `HTTP ${res.status}` });
        continue;
      }
      const type = res.headers.get('content-type') ?? '';
      if (type && !type.startsWith('image/')) {
        skipped.push({ url, reason: `not an image (${type})` });
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) {
        skipped.push({ url, reason: `too large (${buf.byteLength} bytes > ${maxBytes})` });
        continue;
      }
      if (!buf.byteLength) {
        skipped.push({ url, reason: 'empty response' });
        continue;
      }
      const path = uniquePath(dir, nameFor(url, i, type, opts.names?.[i]));
      writeFileSync(path, buf);
      saved.push({ url, path, bytes: buf.byteLength });
    } catch (e) {
      skipped.push({ url, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { dir, saved, skipped };
}
