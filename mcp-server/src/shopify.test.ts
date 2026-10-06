import { describe, expect, it } from 'vitest';
import { readShopifyCatalog, type Fetcher } from './shopify';

const jsonRes = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) });
const product = (i: number, variants: Array<Record<string, unknown>> = [{}]) => ({
  title: `Product ${i}`,
  handle: `product-${i}`,
  vendor: 'Acme',
  product_type: 'Widget',
  tags: ['sale', 'new'],
  images: [{ src: `https://cdn.x.com/${i}.jpg` }],
  variants,
});

describe('readShopifyCatalog', () => {
  it('flattens one row per variant, filling product-level fields on every row', async () => {
    const fetcher: Fetcher = async () => jsonRes({ products: [product(1, [{ title: 'Small', sku: 'S1', price: '10.00', available: true }, { title: 'Large', sku: 'S2', price: '12.00', available: false }])] });
    const r = await readShopifyCatalog('https://shop.example.com', { fetcher });
    expect(r.products).toBe(1);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual(['Product 1', 'Small', 'S1', '10.00', '', 'true', 'Acme', 'Widget', 'sale, new', 'https://cdn.x.com/1.jpg', 'https://shop.example.com/products/product-1']);
    expect(r.rows[1][1]).toBe('Large');
  });

  it('blanks the variant title for the single "Default Title" variant', async () => {
    const fetcher: Fetcher = async () => jsonRes({ products: [product(1, [{ title: 'Default Title', price: '5.00' }])] });
    const r = await readShopifyCatalog('https://shop.example.com', { fetcher });
    expect(r.rows[0][1]).toBe('');
  });

  it('paginates while pages are full, and stops as soon as one comes back short (no wasted trailing request)', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls++;
      if (calls === 1) return jsonRes({ products: Array.from({ length: 250 }, (_, i) => product(i)) });
      return jsonRes({ products: [product(999)] }); // page 2: fewer than 250 -> last page
    };
    const r = await readShopifyCatalog('https://shop.example.com', { fetcher, maxPages: 10 });
    expect(calls).toBe(2);
    expect(r.products).toBe(251);
    expect(r.truncated).toBe(false);
  });

  it('still stops correctly if the very last page happens to come back empty', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls++;
      return calls === 1 ? jsonRes({ products: [product(1)] }) : jsonRes({ products: [] });
    };
    const r = await readShopifyCatalog('https://shop.example.com', { fetcher, maxPages: 10 });
    expect(r.products).toBe(1);
  });

  it('caps at maxProducts and reports truncated', async () => {
    const fetcher: Fetcher = async () => jsonRes({ products: Array.from({ length: 250 }, (_, i) => product(i)) });
    const r = await readShopifyCatalog('https://shop.example.com', { fetcher, maxProducts: 10, maxPages: 5 });
    expect(r.products).toBe(10);
    expect(r.rows).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });

  it('throws a clear error when the first page is not a Shopify store', async () => {
    const fetcher: Fetcher = async () => jsonRes({}, false, 404);
    await expect(readShopifyCatalog('https://not-shopify.example.com', { fetcher })).rejects.toThrow(/not a reachable Shopify catalogue/);
  });

  it('stops gracefully (keeping earlier rows) if a later page fails', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls++;
      if (calls === 1) return jsonRes({ products: Array.from({ length: 250 }, (_, i) => product(i)) });
      return jsonRes({}, false, 500);
    };
    const r = await readShopifyCatalog('https://shop.example.com', { fetcher, maxPages: 5 });
    expect(r.products).toBe(250);
  });
});
