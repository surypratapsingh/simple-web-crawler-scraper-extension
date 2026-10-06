import { expect, test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { call, down, env, up } from './harness';

test.beforeAll(up);
test.afterAll(down);

type Row = Record<string, string>;
const rowsOf = (file: string): Row[] => JSON.parse(readFileSync(file, 'utf8'));

test('extract_urls: one row per URL, auto JSON-LD/meta extraction, tolerates a page with no item data', async () => {
  const r = await call('extract_urls', {
    urls: [`${env.base}/item/1`, `${env.base}/item/4`, `${env.base}/item/7`],
    saveAs: 'json',
    waitSec: 20,
  });
  expect(r.isError, r.text).toBe(false);
  const m = /batch \w+: finished \(done\): 3 of 3 pages visited, 3 rows/.exec(r.text);
  expect(m, r.text).toBeTruthy();
  const file = /saved: (.+\.json)/.exec(r.text)![1];
  const rows = rowsOf(file);
  expect(rows.find((x) => x.url.endsWith('/item/1'))).toMatchObject({ d_title: 'Gadget 1', d_price: '47.99', d_sku: 'SKU-0001' });
  expect(rows.find((x) => x.url.endsWith('/item/4'))).toMatchObject({ d_title: 'Gadget 4', d_price: '' }); // no JSON-LD: falls back to h1
  expect(rows.find((x) => x.url.endsWith('/item/7'))).toMatchObject({ d_title: 'Not found' });
});

test('extract_urls: explicit fields', async () => {
  const r = await call('extract_urls', {
    urls: [`${env.base}/item/2`],
    fields: { weight: { selector: '.specs li' }, tags: { selector: '.tag', join: true } },
    saveAs: 'json',
  });
  const file = /saved: (.+\.json)/.exec(r.text)![1];
  expect(rowsOf(file)[0]).toMatchObject({ weight: 'Weight: 20 g', tags: 't2a | t2b' });
});

test('find_contacts: instant single-page mode reads emails, phones and social links, filtering generic pages', async () => {
  const p = await env.context.newPage();
  await p.goto(`${env.base}/contacts.html`);
  const { text } = await call('list_tabs');
  const line = text.split('\n').find((l) => l.includes('/contacts.html'))!;
  const tabId = Number(line.split('\t')[0].replace('*', ''));
  const r = await call('find_contacts', { tabId });
  expect(r.isError, r.text).toBe(false);
  expect(r.text).toContain('sales@example.com');
  expect(r.text).toContain('support@example.com');
  expect(r.text).toMatch(/phones \(1\)/); // only the tel: link is unambiguous enough to count as 1 here
  expect(r.text).toMatch(/social \(2\)/); // the bare X homepage link is filtered out; only 2 real profiles remain
  expect(r.text).toContain('x:https://x.com/acmeinc');
  expect(r.text).toContain('linkedin:https://www.linkedin.com/company/acmeinc');
  await p.close();
});

test('find_contacts: discoverFrom follows a same-site link to reach the real contact page', async () => {
  const r = await call('find_contacts', {
    discoverFrom: { url: `${env.base}/contacts-landing.html`, maxPages: 2 },
    saveAs: 'json',
  });
  expect(r.isError, r.text).toBe(false);
  const file = /saved: (.+\.json)/.exec(r.text)![1];
  const rows = rowsOf(file);
  expect(rows).toHaveLength(2);
  const contactRow = rows.find((x) => x.url.endsWith('/contacts.html'))!;
  expect(contactRow.emails).toContain('sales@example.com');
  expect(contactRow.social).toContain('x:https://x.com/acmeinc');
  const landingRow = rows.find((x) => x.url.endsWith('/contacts-landing.html'))!;
  expect(landingRow.emails).toBe('');
});

test('find_images: lists real images, filters an icon-sized image and an inline data: URI', async () => {
  const p = await env.context.newPage();
  await p.goto(`${env.base}/images.html`);
  const { text } = await call('list_tabs');
  const line = text.split('\n').find((l) => l.includes('/images.html'))!;
  const tabId = Number(line.split('\t')[0].replace('*', ''));
  const r = await call('find_images', { tabId });
  expect(r.isError, r.text).toBe(false);
  expect(r.text).toContain('/img/1.png');
  expect(r.text).toContain('/img/2.png');
  expect(r.text).not.toContain('icon.png');
  expect(r.text).not.toContain('data:image');
  await p.close();
});

test('find_images: download:true fetches the files to disk', async () => {
  const p = await env.context.newPage();
  await p.goto(`${env.base}/images.html`);
  const { text } = await call('list_tabs');
  const line = text.split('\n').find((l) => l.includes('/images.html'))!;
  const tabId = Number(line.split('\t')[0].replace('*', ''));
  const r = await call('find_images', { tabId, download: true, folder: 'gallery-test' });
  expect(r.isError, r.text).toBe(false);
  expect(r.text).toMatch(/downloaded 2 of 2 images to/);
  const dir = /downloaded \d+ of \d+ images to (.+)$/m.exec(r.text)![1].trim();
  expect(existsSync(dir)).toBe(true);
  const files = readdirSync(dir);
  expect(files).toHaveLength(2);
  for (const f of files) expect(readFileSync(join_(dir, f), 'utf8').length).toBeGreaterThan(0);
  await p.close();
});

function join_(a: string, b: string) {
  return a.replace(/[\\/]+$/, '') + '/' + b;
}

test('sitemap_explore: reads a plain sitemap.xml directly', async () => {
  const r = await call('sitemap_explore', { url: `${env.base}/sitemap.xml` });
  expect(r.isError, r.text).toBe(false);
  expect(r.text).toContain(`${env.base}/shop.html`);
  expect(r.text).toContain(`${env.base}/contacts.html`);
  expect(r.text).toMatch(/\[3 of 3 URLs from 1 sitemap file\(s\)\]/);
});

test('sitemap_explore: filter and saveAs', async () => {
  const r = await call('sitemap_explore', { url: `${env.base}/sitemap.xml`, filter: 'contacts', saveAs: 'csv' });
  const file = /saved to (.+\.csv)/.exec(r.text)![1];
  const csv = readFileSync(file, 'utf8');
  expect(csv).toContain('/contacts.html');
  expect(csv).not.toContain('/shop.html');
});

test('shopify_catalog: flattens variants and blanks the Default Title', async () => {
  const r = await call('shopify_catalog', { url: `${env.base}/`, saveAs: 'json' });
  expect(r.isError, r.text).toBe(false);
  const file = /saved to (.+\.json)/.exec(r.text)![1];
  const rows = rowsOf(file);
  expect(rows).toHaveLength(3); // 2 variants of Mug + 1 of Hat
  expect(rows.find((x) => x.sku === 'MUG-BLU')).toMatchObject({ product: 'Acme Mug', variant: 'Blue', price: '12.00', available: 'true' });
  expect(rows.find((x) => x.sku === 'HAT-1')).toMatchObject({ variant: '' }); // Default Title blanked
});

test('recipes: save, list, run with an override, and delete', async () => {
  const saved = await call('recipe_save', { name: 'acme catalog', tool: 'shopify_catalog', args: { url: `${env.base}/` } });
  expect(saved.isError, saved.text).toBe(false);
  expect(saved.text).toContain('acme catalog');

  const list = await call('recipe_list');
  expect(list.text).toContain('acme catalog -> shopify_catalog');

  const ran = await call('recipe_run', { name: 'acme catalog', overrides: { maxProducts: 1 } });
  expect(ran.isError, ran.text).toBe(false);
  expect(ran.text).toContain('[recipe "acme catalog" -> shopify_catalog]');
  expect(ran.text).toContain('Acme Mug');

  const deleted = await call('recipe_delete', { name: 'acme catalog' });
  expect(deleted.text).toContain('deleted recipe "acme catalog"');
  expect((await call('recipe_list')).text).toContain('no recipes saved yet');
});

test('recipe_save refuses an unknown tool name', async () => {
  const r = await call('recipe_save', { name: 'bad', tool: 'not_a_real_tool', args: {} });
  expect(r.isError).toBe(true);
  expect(r.text).toContain('BAD_ARGS');
});

test('batch_status / batch_cancel operate on the latest batch job', async () => {
  const start = await call('extract_urls', { urls: [`${env.base}/item/1`, `${env.base}/item/2`, `${env.base}/item/3`], delayMs: 3000, waitSec: 0 });
  const m = /^batch (\w+): running/.exec(start.text);
  expect(m, start.text).toBeTruthy();
  const id = m![1];
  const status = await call('batch_status', { jobId: id });
  expect(status.text).toContain(id);
  const cancelled = await call('batch_cancel', { jobId: id });
  expect(cancelled.text).toContain('cancelled');
});
