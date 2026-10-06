// Pure-Node Shopify catalogue reader ("Shopify Extractor"). Every Shopify storefront publishes its
// catalogue at /products.json — a public, unauthenticated endpoint, so this fetches it directly
// rather than through the user's browser (faster, and doesn't need a tab).

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export const SHOPIFY_COLUMNS = [
  'product',
  'variant',
  'sku',
  'price',
  'compare_at_price',
  'available',
  'vendor',
  'product_type',
  'tags',
  'image',
  'url',
] as const;

interface ShopifyVariant {
  title?: string;
  sku?: string;
  price?: string;
  compare_at_price?: string | null;
  available?: boolean;
}
interface ShopifyProduct {
  title?: string;
  handle?: string;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  images?: Array<{ src?: string }>;
  variants?: ShopifyVariant[];
}

function flatten(base: URL, p: ShopifyProduct): string[][] {
  const tags = Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags ?? '');
  const image = p.images?.[0]?.src ?? '';
  const url = p.handle ? new URL(`/products/${p.handle}`, base).href : '';
  const variants = p.variants?.length ? p.variants : [{}];
  return variants.map((v) => [
    p.title ?? '',
    v.title && v.title !== 'Default Title' ? v.title : '',
    v.sku ?? '',
    v.price ?? '',
    v.compare_at_price ?? '',
    v.available === undefined ? '' : String(v.available),
    p.vendor ?? '',
    p.product_type ?? '',
    tags,
    image,
    url,
  ]);
}

export interface ShopifyResult {
  columns: readonly string[];
  rows: string[][];
  products: number;
  pagesRead: number;
  truncated: boolean;
}

/** Reads a Shopify store's /products.json, paginated, flattened to one row per variant. */
export async function readShopifyCatalog(
  shopUrl: string,
  opts: { maxProducts?: number; maxPages?: number; fetcher?: Fetcher } = {},
): Promise<ShopifyResult> {
  const fetcher: Fetcher = opts.fetcher ?? ((u) => fetch(u));
  const maxProducts = Math.min(opts.maxProducts ?? 1000, 5000);
  const maxPages = Math.min(opts.maxPages ?? 20, 40); // Shopify caps page size at 250 -> 40*250 = 10k products ceiling
  const base = new URL(shopUrl);
  const rows: string[][] = [];
  let products = 0;
  let page = 1;
  let truncated = false;

  for (; page <= maxPages; page++) {
    const r = await fetcher(`${base.origin}/products.json?limit=250&page=${page}`);
    if (!r.ok) {
      if (page === 1) throw new Error(`not a reachable Shopify catalogue (products.json returned HTTP ${r.status})`);
      break;
    }
    let body: { products?: ShopifyProduct[] };
    try {
      body = (await r.json()) as { products?: ShopifyProduct[] };
    } catch {
      if (page === 1) throw new Error('not a reachable Shopify catalogue (products.json did not return JSON)');
      break;
    }
    const list = body.products ?? [];
    if (!list.length) break;
    for (const p of list) {
      if (products >= maxProducts) {
        truncated = true;
        break;
      }
      rows.push(...flatten(base, p));
      products++;
    }
    if (products >= maxProducts || list.length < 250) break;
  }
  if (page > maxPages) truncated = true;

  return { columns: SHOPIFY_COLUMNS, rows, products, pagesRead: page, truncated };
}
