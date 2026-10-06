import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { call, down, env, freePort, newClient, setStorage, up } from './harness';
import { crawl, csvRows, parse, tabIds, type Parsed } from './crawl-helpers';
import { hits } from './site';

test.beforeAll(up);
test.afterAll(down);

test('changing the port setting at runtime reconnects to the new hub (and back)', async () => {
  const port2 = await freePort();
  const other = await newClient(port2);
  await setStorage({ port: port2 });
  await expect.poll(async () => (await call('browser_status', {}, other)).text, { timeout: 15_000 }).toContain('extensionConnected=true');
  await setStorage({ port: env.bridgePort });
  await expect.poll(async () => (await call('browser_status')).text, { timeout: 15_000 }).toContain('extensionConnected=true');
});

test('follows rel=next across 5 pages, de-dupes, saves a file, leaves the user tabs alone', async () => {
  const shop = await env.context.newPage();
  await shop.goto(`${env.base}/shop.html`);
  const before = await tabIds();

  const r = await crawl({ url: `${env.base}/catalog?page=1`, maxPages: 10, saveAs: 'csv', filename: 'catalog' });
  expect(r.isError, r.text).toBe(false);
  expect([r.state, r.reason, r.pages, r.rows]).toEqual(['finished', 'done_no_next', 5, 25]);

  const rows = csvRows(r.file!);
  expect(rows).toHaveLength(25);
  expect(new Set(rows.map((x) => x.match(/SKU-\d+/)![0])).size).toBe(25); // no duplicates
  expect(rows[0]).toContain('Gadget 1');
  expect(rows[24]).toContain('Gadget 25');
  expect(r.text.length).toBeLessThan(1500); // 25 rows saved, only a few lines of tokens

  expect(await tabIds()).toEqual(before); // its private tab was closed, nothing else touched
  expect(new URL(shop.url()).pathname).toBe('/shop.html');
  await shop.close();
});

test('urlTemplate pagination needs no next links and honours maxPages', async () => {
  const r = await crawl({
    pagination: { type: 'template', urlTemplate: `${env.base}/catalog-plain?page={n}` },
    maxPages: 4,
  });
  expect([r.reason, r.pages, r.rows]).toEqual(['max_pages', 4, 20]);
});

test('clicks a client-side Next button (content replaced, no navigation)', async () => {
  const r = await crawl({ url: `${env.base}/catalog-click.html`, maxPages: 10 });
  expect([r.reason, r.pages, r.rows]).toEqual(['done_no_next', 5, 25]);
});

test('clicks Load more until it disappears (content appended)', async () => {
  const r = await crawl({ url: `${env.base}/catalog-more.html`, maxPages: 10 });
  expect([r.reason, r.pages, r.rows]).toEqual(['done_no_next', 5, 25]);
});

test('infinite scroll stops when no new rows arrive', async () => {
  const r = await crawl({ url: `${env.base}/catalog-infinite.html`, pagination: { type: 'scroll' }, maxPages: 15 });
  expect(r.reason).toBe('no_new_rows');
  expect(r.rows).toBe(25);
});

test('a next link that loops back on repeated content is caught by the duplicate guard', async () => {
  const r = await crawl({ url: `${env.base}/catalog-loop?page=1`, maxPages: 20 });
  expect(r.reason).toBe('no_new_rows');
  expect(r.rows).toBe(25);
  expect(r.pages).toBeLessThanOrEqual(7);
});

test('maxRows truncates exactly and stops', async () => {
  const r = await crawl({ url: `${env.base}/catalog?page=1`, maxRows: 12, maxPages: 10 });
  expect([r.reason, r.rows]).toEqual(['max_rows', 12]);
});

test('fields mode reuses explicit selectors on every page', async () => {
  const r = await crawl({
    url: `${env.base}/catalog?page=1`,
    mode: 'fields',
    rowSelector: '.item',
    fields: { name: { selector: '.name' }, price: { selector: '.price' } },
    maxPages: 3,
    saveAs: 'json',
  });
  expect([r.reason, r.rows]).toEqual(['max_pages', 15]);
  const data = JSON.parse(readFileSync(r.file!, 'utf8'));
  expect(data[0]).toEqual({ name: 'Gadget 1', price: '$47.99' });
  expect(data).toHaveLength(15);
});

test('robots.txt: warns by default, refuses when respectRobots is set', async () => {
  const warn = await crawl({ url: `${env.base}/private-catalog?page=1`, maxPages: 1 });
  expect(warn.text).toContain('WARNING: robots.txt disallows');
  const refuse = await crawl({ url: `${env.base}/private-catalog?page=1`, respectRobots: true });
  expect(refuse.isError).toBe(true);
  expect(refuse.text).toContain('ROBOTS');
});

test('never clicks destructive controls, even when asked via a selector', async () => {
  hits.length = 0;
  const heuristic = await crawl({ url: `${env.base}/catalog-danger.html`, maxPages: 5 });
  expect([heuristic.reason, heuristic.pages]).toEqual(['done_no_next', 1]);

  const forced = await crawl({ url: `${env.base}/catalog-danger.html`, pagination: { selector: '.del' }, maxPages: 5 });
  expect(forced.reason).toBe('error');
  expect(forced.text).toContain('destructive');
  const forcedBuy = await crawl({ url: `${env.base}/catalog-danger.html`, pagination: { selector: '.buy' }, maxPages: 5 });
  expect(forcedBuy.text).toContain('destructive');
  expect(hits).toEqual([]); // nothing was ever clicked
});

test('only one crawl at a time; cancel keeps and saves partial rows', async () => {
  const first = parse(
    await call('crawl_start', { url: `${env.base}/catalog?page=1`, delayMs: 3000, maxPages: 10, waitSec: 0, saveAs: 'ndjson' }),
  );
  expect(first.state).toBe('running');
  const second = await call('crawl_start', { url: `${env.base}/catalog?page=1`, waitSec: 0 });
  expect(second.isError).toBe(true);
  expect(second.text).toContain('BUSY');

  await expect
    .poll(async () => parse(await call('crawl_status', { jobId: first.id })).rows, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(5);
  const done = parse(await call('crawl_cancel', { jobId: first.id }));
  expect([done.state, done.reason]).toEqual(['finished', 'cancelled']);
  expect(done.rows).toBeGreaterThanOrEqual(5);
  expect(readFileSync(done.file!, 'utf8').trim().split('\n').length).toBe(done.rows);
});

test('inPlace crawls inside the given tab', async () => {
  const p = await env.context.newPage();
  await p.goto(`${env.base}/catalog?page=1`);
  const { text } = await call('list_tabs');
  const id = Number(text.split('\n').find((l) => l.includes('/catalog?page=1'))!.split('\t')[0].replace('*', ''));
  const r = await crawl({ tabId: id, inPlace: true, maxPages: 10 });
  expect([r.reason, r.rows]).toEqual(['done_no_next', 25]);
  expect(new URL(p.url()).searchParams.get('page')).toBe('5'); // the user's tab really moved
  await p.close();
});

test('the kill switch stops a running crawl', async () => {
  const start = parse(await call('crawl_start', { url: `${env.base}/catalog?page=1`, delayMs: 1000, maxPages: 10, waitSec: 0 }));
  await expect.poll(async () => parse(await call('crawl_status', { jobId: start.id })).pages, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await setStorage({ enabled: false });
  await new Promise((r) => setTimeout(r, 3500)); // longer than the max delay (1.5 s) + a page
  await setStorage({ enabled: true });
  const done = parse(await call('crawl_status', { jobId: start.id }));
  expect([done.state, done.reason]).toEqual(['finished', 'disabled']);
  expect(done.rows).toBeLessThan(25);
});

test('audit log records each crawled page (host only, no content)', async () => {
  const log = await env.sw.evaluate(async () => (await chrome.storage.local.get('audit')).audit as Array<Record<string, unknown>>);
  const pages = log.filter((e) => e.method === 'crawl_page');
  expect(pages.length).toBeGreaterThan(10);
  expect(JSON.stringify(log)).not.toContain('Gadget');
});

test('a crawl survives the service worker being killed and finishes with no gaps or duplicates', async () => {
  test.setTimeout(150_000);
  const start = parse(
    await call('crawl_start', { url: `${env.base}/catalog?page=1`, delayMs: 1500, maxPages: 10, waitSec: 0, saveAs: 'csv', filename: 'resumed' }),
  );
  await expect.poll(async () => parse(await call('crawl_status', { jobId: start.id })).pages, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);

  const cdp = await env.context.newCDPSession(await env.context.newPage());
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers'); // kill the worker mid-crawl
  await expect
    .poll(async () => (await call('browser_status')).text, { timeout: 15_000, intervals: [250, 500, 1000] })
    .toContain('extensionConnected=false');

  // The 30 s alarm wakes the worker; it reconnects and resumes the persisted job.
  let final: Parsed = start;
  await expect
    .poll(
      async () => {
        final = parse(await call('crawl_status', { jobId: start.id, waitSec: 5 }));
        return final.state;
      },
      { timeout: 100_000, intervals: [1000, 2000, 3000] },
    )
    .toBe('finished');
  expect(final.reason, final.text).toBe('done_no_next');
  expect(final.rows, final.text).toBe(25);
  const rows = csvRows(final.file!);
  const skus = rows.map((x) => x.match(/SKU-(\d+)/)![1]);
  expect(new Set(skus).size).toBe(25);
  expect(skus.map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1)); // no gaps
});
