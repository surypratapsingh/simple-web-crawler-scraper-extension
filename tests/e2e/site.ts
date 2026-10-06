// Dynamic fixture site for crawl tests. Every catalogue has 25 items (5 per page x 5 pages).

export const hits: string[] = []; // requests to /hit (used to prove destructive buttons are never clicked)
export const visits: number[] = []; // every /item/N request, to prove detail pages are fetched exactly once

const PER = 5;
const PAGES = 5;

const price = (id: number) => `$${((id * 37) % 90) + 10}.99`;
const item = (id: number) =>
  `<div class="item"><a class="name" href="/item/${id}">Gadget ${id}</a><span class="price">${price(id)}</span><span class="sku">SKU-${String(id).padStart(4, '0')}</span></div>`;
const items = (page: number) =>
  Array.from({ length: PER }, (_, i) => item((page - 1) * PER + i + 1)).join('\n');

const shell = (title: string, body: string, head = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><main><h1>${title}</h1>${body}</main></body></html>`;

const page = (title: string, path: string, n: number, opts: { next?: boolean; loop?: boolean } = {}) => {
  const shown = opts.loop ? Math.min(n, PAGES) : n;
  const hasNext = opts.next !== false && (opts.loop || n < PAGES);
  const nav = hasNext
    ? `<nav class="pagination" aria-label="Pagination"><a rel="next" href="${path}?page=${n + 1}">Next &rsaquo;</a></nav>`
    : `<nav class="pagination" aria-label="Pagination"><span class="disabled">Next</span></nav>`;
  return shell(`${title} page ${shown}`, `<div class="results">${items(shown)}</div>${opts.next === false ? '' : nav}`);
};

const CLIENT_PAGED = shell(
  'Client-side pager',
  `<div class="results"></div><button class="next" type="button">Next</button>
<script>
  const PER=${PER}, PAGES=${PAGES}; let p=1;
  const price=${price.toString()}; const item=${item.toString()};
  const render=()=>{ document.querySelector('.results').innerHTML=Array.from({length:PER},(_,i)=>item((p-1)*PER+i+1)).join(''); document.querySelector('.next').disabled = p>=PAGES; };
  document.querySelector('.next').addEventListener('click',()=>{ if(p<PAGES){ p++; setTimeout(render,150); } });
  render();
</script>`,
);

const LOAD_MORE = shell(
  'Load more',
  `<div class="results"></div><button class="more" type="button">Load more</button>
<script>
  const PER=${PER}, PAGES=${PAGES}; let p=0;
  const price=${price.toString()}; const item=${item.toString()};
  const more=()=>{ p++; const h=Array.from({length:PER},(_,i)=>item((p-1)*PER+i+1)).join(''); document.querySelector('.results').insertAdjacentHTML('beforeend',h); if(p>=PAGES) document.querySelector('.more').remove(); };
  document.querySelector('.more').addEventListener('click',()=>setTimeout(more,150));
  more();
</script>`,
);

const INFINITE = shell(
  'Infinite scroll',
  `<div class="results"></div><div class="spacer" style="height:1400px"></div>
<script>
  const PER=${PER}, PAGES=${PAGES}; let p=0, loading=false;
  const price=${price.toString()}; const item=${item.toString()};
  const add=()=>{ p++; document.querySelector('.results').insertAdjacentHTML('beforeend',Array.from({length:PER},(_,i)=>item((p-1)*PER+i+1)).join('')); loading=false; };
  const check=()=>{ if(!loading && p<PAGES && window.innerHeight+window.scrollY >= document.documentElement.scrollHeight-300){ loading=true; setTimeout(add,250); } };
  window.addEventListener('scroll',check); add();
</script>`,
);

const DANGER = shell(
  'Dangerous buttons',
  `<div class="results">${items(1)}</div>
<button class="del" type="button" onclick="fetch('/hit?what=delete')">Delete all</button>
<button class="buy" type="button" onclick="fetch('/hit?what=buy')">Buy now</button>`,
);

export interface Reply {
  status: number;
  type: string;
  body: string;
}

const itemPage = (id: number): Reply => {
  visits.push(id);
  const html = (body: string): Reply => ({ status: 200, type: 'text/html; charset=utf-8', body });
  if (id === 7) return html(shell('Not found', '<p>No such item.</p>')); // a page with no item data at all
  const ld =
    id === 4 // no structured data: auto mode must fall back to h1 / meta
      ? ''
      : `<script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: `Gadget ${id}`,
          sku: `SKU-${String(id).padStart(4, '0')}`,
          offers: { '@type': 'Offer', price: price(id).slice(1), priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
        })}</script>`;
  return html(
    shell(
      `Gadget ${id}`,
      `<ul class="specs"><li>Weight: ${id * 10} g</li><li>Color: c${id}</li></ul>` +
        `<span class="tag">t${id}a</span><span class="tag">t${id}b</span>` +
        `<p>Long description for gadget ${id}. It is a very fine gadget with many features worth reading about.</p>`,
      `<meta name="description" content="Description of gadget ${id}"><link rel="canonical" href="/item/${id}">${ld}`,
    ),
  );
};

// Catalogue whose item 3 links to another host and item 6 has an empty link.
const detailCatalog = (n: number, other: string) =>
  shell(
    'Detail catalogue',
    '<div class="results">' +
      Array.from({ length: PER }, (_, i) => {
        const id = (n - 1) * PER + i + 1;
        const href = id === 3 ? `${other}/item/${id}` : id === 6 ? '' : `/item/${id}`;
        return `<div class="item"><a class="name" href="${href}">Gadget ${id}</a><span class="price">${price(id)}</span><span class="sku">SKU-${String(id).padStart(4, '0')}</span></div>`;
      }).join('') +
      '</div>' +
      (n < PAGES ? `<nav class="pagination" aria-label="Pagination"><a rel="next" href="/catalog-detail?page=${n + 1}">Next &rsaquo;</a></nav>` : ''),
  );

// ---- fixtures for find_contacts / find_images / sitemap_explore / shopify_catalog ----

const CONTACTS_PAGE = shell(
  'Contact us',
  `<p>Email <a href="mailto:Sales@Example.com">sales</a> or call <a href="tel:+1-555-123-4567">+1-555-123-4567</a>.</p>
   <p>You can also reach support at support@example.com.</p>
   <a href="https://x.com/acmeinc">X</a> <a href="https://www.linkedin.com/company/acmeinc/">LinkedIn</a>
   <a href="https://x.com/">X home (should be filtered out)</a>`,
);
const CONTACTS_LANDING = shell('Acme home', '<p>Welcome to Acme.</p><nav><a href="/contacts.html">About &amp; Contact</a></nav>');

const IMAGES_PAGE = shell(
  'Gallery',
  `<img src="/img/1.png" width="200" height="150" alt="Photo one">
   <img src="/img/2.png" width="300" height="200" alt="Photo two">
   <img src="/img/icon.png" width="10" height="10" alt="tiny icon">
   <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="inline">`,
);
// Not a real, decodable PNG -- only its content-type and non-zero length matter for these tests
// (find_images lists via HTML width/height attributes; downloadImages only checks headers + size).
const FAKE_PNG_BODY = 'fake-png-bytes-for-testing-only-'.repeat(4);

const SITEMAP_XML = `<?xml version="1.0"?><urlset>
  <url><loc>{{BASE}}/catalog?page=1</loc></url>
  <url><loc>{{BASE}}/shop.html</loc></url>
  <url><loc>{{BASE}}/contacts.html</loc></url>
</urlset>`;

const SHOPIFY_PRODUCTS = (page: number) =>
  page > 1
    ? { products: [] }
    : {
        products: [
          {
            title: 'Acme Mug',
            handle: 'acme-mug',
            vendor: 'Acme',
            product_type: 'Kitchen',
            tags: ['sale'],
            images: [{ src: '/img/1.png' }],
            variants: [
              { title: 'Blue', sku: 'MUG-BLU', price: '12.00', available: true },
              { title: 'Red', sku: 'MUG-RED', price: '12.00', available: false },
            ],
          },
          { title: 'Acme Hat', handle: 'acme-hat', vendor: 'Acme', product_type: 'Apparel', tags: 'summer', images: [], variants: [{ title: 'Default Title', sku: 'HAT-1', price: '20.00', available: true }] },
        ],
      };

export function dynamicRoute(rawUrl: string, ctx: { other?: string; base?: string } = {}): Reply | null {
  const u = new URL(rawUrl, 'http://x');
  const n = Math.max(1, Number(u.searchParams.get('page') ?? 1));
  const html = (body: string): Reply => ({ status: 200, type: 'text/html; charset=utf-8', body });
  const json = (body: unknown): Reply => ({ status: 200, type: 'application/json', body: JSON.stringify(body) });
  const itemMatch = /^\/item\/(\d+)$/.exec(u.pathname);
  if (itemMatch) return itemPage(Number(itemMatch[1]));
  const imgMatch = /^\/img\/[\w-]+\.png$/.exec(u.pathname);
  if (imgMatch) return { status: 200, type: 'image/png', body: FAKE_PNG_BODY };
  switch (u.pathname) {
    case '/contacts.html':
      return html(CONTACTS_PAGE);
    case '/contacts-landing.html':
      return html(CONTACTS_LANDING);
    case '/images.html':
      return html(IMAGES_PAGE);
    case '/sitemap.xml':
      return { status: 200, type: 'application/xml', body: SITEMAP_XML.replaceAll('{{BASE}}', ctx.base ?? '') };
    case '/products.json':
      return json(SHOPIFY_PRODUCTS(n));
    case '/catalog-detail':
      return html(detailCatalog(Math.min(n, PAGES), ctx.other ?? ''));
    case '/catalog':
      return html(page('Catalogue', '/catalog', Math.min(n, PAGES)));
    case '/catalog-plain':
      return html(page('Plain', '/catalog-plain', Math.min(n, PAGES), { next: false }));
    case '/catalog-loop':
      return html(page('Loop', '/catalog-loop', n, { loop: true }));
    case '/private-catalog':
      return html(page('Private', '/private-catalog', Math.min(n, PAGES)));
    case '/catalog-click.html':
      return html(CLIENT_PAGED);
    case '/catalog-more.html':
      return html(LOAD_MORE);
    case '/catalog-infinite.html':
      return html(INFINITE);
    case '/catalog-danger.html':
      return html(DANGER);
    case '/hit':
      hits.push(u.searchParams.get('what') ?? '?');
      return { status: 204, type: 'text/plain', body: '' };
    case '/robots.txt':
      return { status: 200, type: 'text/plain', body: 'User-agent: *\nDisallow: /private-catalog\n' };
    default:
      return null;
  }
}
