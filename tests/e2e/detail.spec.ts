import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { crawl, parse, tabIds } from './crawl-helpers';
import { call, down, env, setStorage, up } from './harness';
import { visits } from './site';

test.beforeAll(up);
test.afterAll(down);
test.beforeEach(() => {
  visits.length = 0;
});

type Row = Record<string, string>;
const rowsOf = (file: string): Row[] => JSON.parse(readFileSync(file, 'utf8'));
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const detail = (extra: Record<string, unknown> = {}, args: Record<string, unknown> = {}) =>
  crawl({ url: `${env.base}/catalog?page=1`, maxPages: 2, saveAs: 'json', maxSeconds: 180, detail: extra, ...args });

test('auto mode appends JSON-LD facts, falls back to h1/meta, and visits each row exactly once', async () => {
  const before = await tabIds();
  const r = await detail();
  expect(r.isError, r.text).toBe(false);
  expect([r.state, r.reason, r.rows]).toEqual(['finished', 'max_pages', 10]);
  expect(r.text).toContain('10 detail visits');

  const data = rowsOf(r.file!);
  expect(data[0]).toMatchObject({
    name: 'Gadget 1',
    sku: 'SKU-0001', // list columns come first and are untouched
    d_title: 'Gadget 1',
    d_price: '47.99',
    d_currency: 'USD',
    d_sku: 'SKU-0001',
    d_availability: 'InStock',
    d_description: 'Description of gadget 1',
    detail_status: 'ok',
  });
  expect(data[0].d_text).toContain('Weight: 10 g');
  // no JSON-LD on item 4: title falls back to the h1, price/sku stay empty
  expect(data[3]).toMatchObject({ name: 'Gadget 4', d_title: 'Gadget 4', d_price: '', d_sku: '', d_description: 'Description of gadget 4', detail_status: 'ok' });
  expect(data[6].d_title).toBe('Not found'); // item 7's page has no item data; the h1 is still read
  expect(data.map((d) => d.name)).toEqual(range(10).map((i) => `Gadget ${i}`)); // order preserved

  expect(sorted(visits)).toEqual(range(10)); // every detail page fetched exactly once
  expect(await tabIds()).toEqual(before); // both private tabs (list + detail) are closed
});

test('fields mode uses selectors, join, attributes, and renames colliding column names', async () => {
  const r = await detail({
    fields: {
      weight: { selector: '.specs li' },
      tags: { selector: '.tag', join: true },
      canonical: { selector: 'link[rel=canonical]', attr: 'href' },
      name: { selector: 'h1' }, // collides with the list column "name"
    },
  });
  expect([r.reason, r.rows]).toEqual(['max_pages', 10]);
  const data = rowsOf(r.file!);
  expect(data[0]).toMatchObject({
    name: 'Gadget 1', // the list value survives
    name_d: 'Gadget 1', // the detail value is renamed, never overwritten
    weight: 'Weight: 10 g',
    tags: 't1a | t1b',
    canonical: `${env.base}/item/1`,
    detail_status: 'ok',
  });
  // item 7's page has no specs/tags/canonical, only an h1: partial data is still "ok" (all-blank would be "empty")
  expect(data[6]).toMatchObject({ name: 'Gadget 7', weight: '', tags: '', canonical: '', name_d: 'Not found', detail_status: 'ok' });
  expect(data).toHaveLength(10);
  // columns keep the requested order (fields were given as weight, tags, canonical, name)
  expect(Object.keys(data[0]).slice(-5)).toEqual(['weight', 'tags', 'canonical', 'name_d', 'detail_status']);
});

test('off-site and empty links are skipped with a status, and never fetched', async () => {
  const r = await crawl({
    url: `${env.base}/catalog-detail?page=1`,
    maxPages: 1,
    saveAs: 'json',
    detail: { linkColumn: 'name_url' },
  });
  expect([r.reason, r.rows]).toEqual(['max_pages', 5]);
  const data = rowsOf(r.file!);
  const byName = Object.fromEntries(data.map((d) => [d.name, d.detail_status]));
  expect(byName).toEqual({
    'Gadget 1': 'ok',
    'Gadget 2': 'ok',
    'Gadget 3': 'off_site', // links to another host
    'Gadget 4': 'ok',
    'Gadget 5': 'ok',
  });
  const gadget3 = data.find((d) => d.name === 'Gadget 3')!;
  expect(gadget3.d_title).toBe('');
  expect(sorted(visits)).toEqual([1, 2, 4, 5]); // 3 (other host) never requested
  expect(r.text).toContain('4 detail visits');
});

test('an empty link is recorded as no_link', async () => {
  const r = await crawl({
    url: `${env.base}/catalog-detail?page=2`,
    maxPages: 1,
    saveAs: 'json',
    detail: {},
  });
  const data = rowsOf(r.file!);
  expect(data.find((d) => d.name === 'Gadget 6')!.detail_status).toBe('no_link');
  expect(visits).not.toContain(6);
  expect(sorted(visits)).toEqual([7, 8, 9, 10]);
});

test('three failed visits in a row stop the crawl instead of hammering the site', async () => {
  const r = await detail({ fields: { x: { selector: '.does-not-exist' } } }, { maxPages: 5 });
  expect(r.reason, r.text).toBe('detail_errors');
  expect(visits).toHaveLength(3);
  const data = rowsOf(r.file!);
  expect(data).toHaveLength(3);
  expect(data.every((d) => d.detail_status === 'empty')).toBe(true);
});

test('maxDetails caps the visits', async () => {
  const r = await detail({ maxDetails: 4 }, { maxPages: 5 });
  expect([r.reason, r.rows]).toEqual(['max_details', 4]);
  expect(visits).toHaveLength(4);
});

test('bad configuration fails fast with a clear message and visits nothing', async () => {
  const wrongColumn = await detail({ linkColumn: 'nope' });
  expect(wrongColumn.reason).toBe('error');
  expect(wrongColumn.text).toContain('not one of the columns');

  const noLink = await crawl({
    url: `${env.base}/catalog?page=1`,
    mode: 'fields',
    rowSelector: '.item',
    fields: { name: { selector: '.name' } },
    detail: {},
  });
  expect(noLink.reason).toBe('error');
  expect(noLink.text).toContain('no link column found');
  expect(visits).toHaveLength(0);
});

test('fields-mode list + detail: an explicit link field works', async () => {
  const r = await crawl({
    url: `${env.base}/catalog?page=1`,
    mode: 'fields',
    rowSelector: '.item',
    fields: { title: { selector: '.name' }, link: { selector: '.name', attr: 'href' } },
    detail: { fields: { weight: { selector: '.specs li' } } },
    maxPages: 1,
    saveAs: 'json',
  });
  expect([r.reason, r.rows]).toEqual(['max_pages', 5]);
  const data = rowsOf(r.file!);
  expect(data[2]).toMatchObject({ title: 'Gadget 3', weight: 'Weight: 30 g', detail_status: 'ok' });
  // requested order (title before link) survives; alphabetical would put link first
  expect(Object.keys(data[0])).toEqual(['title', 'link', 'weight', 'detail_status']);
});

test('page_extract fields mode keeps the requested column order', async () => {
  const p = await env.context.newPage();
  await p.goto(`${env.base}/catalog?page=1`);
  const { text } = await call('list_tabs');
  const line = text.split('\n').find((l) => l.includes('/catalog?page=1'))!;
  const id = Number(line.split('\t')[0].replace('*', ''));
  const r = await call('page_extract', {
    tabId: id,
    mode: 'fields',
    rowSelector: '.item',
    fields: { sku: { selector: '.sku' }, price: { selector: '.price' }, name: { selector: '.name' } }, // not alphabetical, on purpose
    limit: 2,
  });
  expect(r.text).toContain('\nsku\tprice\tname\nSKU-0001\t$47.99\tGadget 1\n');
  await p.close();
});

test('the kill switch stops the detail phase and no visit is wasted', async () => {
  const start = parse(
    await call('crawl_start', { url: `${env.base}/catalog?page=1`, delayMs: 1000, maxPages: 5, waitSec: 0, saveAs: 'json', detail: {} }),
  );
  await expect
    .poll(async () => Number(/(\d+) detail visits/.exec((await call('crawl_status', { jobId: start.id })).text)?.[1] ?? 0), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);
  await setStorage({ enabled: false });
  await new Promise((r) => setTimeout(r, 3500));
  await setStorage({ enabled: true });
  const done = parse(await call('crawl_status', { jobId: start.id }));
  expect([done.state, done.reason]).toEqual(['finished', 'disabled']);
  expect(done.rows).toBeGreaterThanOrEqual(2);
  expect(done.rows).toBe(visits.length); // every page visited produced a stored row
  expect(done.rows).toBeLessThan(25);
});

test('a crawl with detail pages survives a killed worker: no gaps, no duplicates, few re-visits', async () => {
  test.setTimeout(180_000);
  const start = parse(
    await call('crawl_start', {
      url: `${env.base}/catalog?page=1`,
      delayMs: 1500,
      maxPages: 2,
      maxSeconds: 300,
      waitSec: 0,
      saveAs: 'json',
      filename: 'detail-resumed',
      detail: {},
    }),
  );
  await expect
    .poll(async () => Number(/(\d+) detail visits/.exec((await call('crawl_status', { jobId: start.id })).text)?.[1] ?? 0), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(3);

  const cdp = await env.context.newCDPSession(await env.context.newPage());
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await expect
    .poll(async () => (await call('browser_status')).text, { timeout: 15_000, intervals: [250, 500, 1000] })
    .toContain('extensionConnected=false');

  let final = start;
  await expect
    .poll(
      async () => {
        final = parse(await call('crawl_status', { jobId: start.id, waitSec: 5 }));
        return final.state;
      },
      { timeout: 120_000, intervals: [1000, 2000, 3000] },
    )
    .toBe('finished');
  expect(final.reason, final.text).toBe('max_pages');
  expect(final.rows, final.text).toBe(10);

  const data = rowsOf(final.file!);
  expect(data.map((d) => d.name)).toEqual(range(10).map((i) => `Gadget ${i}`)); // in order, no gaps, no duplicates
  expect(data.every((d) => d.detail_status === 'ok')).toBe(true);
  expect(new Set(visits)).toEqual(new Set(range(10))); // every detail page was fetched
  expect(visits.length).toBeLessThanOrEqual(10 + 6); // at most one unsaved batch + the in-flight visit repeated
});
