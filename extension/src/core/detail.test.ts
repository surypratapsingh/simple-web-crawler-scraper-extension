// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DETAIL_AUTO_COLUMNS, hostRelated, resolveLinkIndex, toPairs, uniqueNames } from './crawl-util';
import { detailExtract, jsonLd } from './detail';

const page = (head: string, body: string) => {
  document.head.innerHTML = head;
  document.body.innerHTML = body;
};
const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;

beforeEach(() => page('', ''));

describe('jsonLd', () => {
  it('reads a Product with a single Offer', () => {
    page(
      ld({ '@context': 'https://schema.org', '@type': 'Product', name: 'Widget', sku: 'W-1', offers: { '@type': 'Offer', price: '19.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } }),
      '',
    );
    expect(jsonLd(document)).toMatchObject({ title: 'Widget', price: '19.99', currency: 'USD', sku: 'W-1', availability: 'InStock' });
  });

  it('finds nodes inside @graph and arrays, takes the first of multiple offers, and lowPrice of AggregateOffer', () => {
    page(ld({ '@graph': [{ '@type': 'WebSite', name: 'Shop' }, { '@type': ['Product'], name: 'G', offers: [{ price: 5 }, { price: 9 }] }] }), '');
    expect(jsonLd(document)).toMatchObject({ title: 'G', price: '5' });
    page(ld({ '@type': 'Product', name: 'H', offers: { '@type': 'AggregateOffer', lowPrice: '3.50', priceCurrency: 'EUR' } }), '');
    expect(jsonLd(document)).toMatchObject({ price: '3.50', currency: 'EUR' });
  });

  it('reads article facts and tolerates malformed JSON-LD', () => {
    page(
      '<script type="application/ld+json">{ not json</script>' + ld({ '@type': 'NewsArticle', headline: 'Big news', datePublished: '2026-01-02', author: { name: 'A' } }),
      '',
    );
    expect(jsonLd(document)).toMatchObject({ title: 'Big news', date: '2026-01-02' });
  });

  it('returns empty strings when there is no JSON-LD', () => {
    expect(jsonLd(document)).toEqual({ title: '', price: '', currency: '', sku: '', availability: '', date: '' });
  });
});

describe('detailExtract auto', () => {
  it('uses the fixed column set and prefers JSON-LD over h1', () => {
    page(
      '<title>T</title><meta name="description" content="A fine widget">' + ld({ '@type': 'Product', name: 'LD name', sku: 'S1', offers: { price: '7.00', priceCurrency: 'GBP' } }),
      '<main><h1>H1 name</h1><p>Body text of the detail page that is long enough to be picked up as the main content region for extraction.</p></main>',
    );
    const r = detailExtract(document);
    expect(r.columns).toEqual([...DETAIL_AUTO_COLUMNS]);
    const v = Object.fromEntries(r.columns.map((c, i) => [c, r.cells[i]]));
    expect(v).toMatchObject({ d_title: 'LD name', d_description: 'A fine widget', d_price: '7.00', d_currency: 'GBP', d_sku: 'S1' });
    expect(v.d_text).toContain('Body text of the detail page');
    expect(v.d_text).not.toContain('\n');
  });

  it('falls back to h1, then <title>, and to time[datetime] for the date', () => {
    page('<title>Doc title</title>', '<main><h1>Heading</h1><time datetime="2026-05-06">May</time></main>');
    const a = detailExtract(document);
    expect(a.cells[0]).toBe('Heading');
    expect(a.cells[DETAIL_AUTO_COLUMNS.indexOf('d_date')]).toBe('2026-05-06');
    page('<title>Doc title</title>', '<main><p>no heading</p></main>');
    expect(detailExtract(document).cells[0]).toBe('Doc title');
  });

  it('caps the text excerpt at textChars', () => {
    page('', `<main><p>${'word '.repeat(300)}</p></main>`);
    const r = detailExtract(document, { textChars: 120 });
    expect(r.cells[DETAIL_AUTO_COLUMNS.indexOf('d_text')].length).toBeLessThanOrEqual(120);
  });
});

describe('detailExtract fields', () => {
  beforeEach(() =>
    page(
      '<link rel="canonical" href="/canon">',
      '<main><ul class="specs"><li>Weight: 5 g</li><li>Color: red</li></ul><span class="tag">a</span><span class="tag">b</span><a class="buy" href="/x">x</a></main>',
    ),
  );

  it('extracts first match text, attributes (absolute URLs), and joins multiple matches', () => {
    const r = detailExtract(document, {
      fields: {
        weight: { selector: '.specs li' },
        tags: { selector: '.tag', join: true },
        canonical: { selector: 'link[rel=canonical]', attr: 'href' },
        missing: { selector: '.nope' },
      },
    });
    expect(r.columns).toEqual(['weight', 'tags', 'canonical', 'missing']);
    expect(r.cells[0]).toBe('Weight: 5 g');
    expect(r.cells[1]).toBe('a | b');
    expect(r.cells[2]).toMatch(/^https?:\/\/.*\/canon$/);
    expect(r.cells[3]).toBe('');
  });
});

describe('detail helpers', () => {
  it('resolveLinkIndex prefers the named column, else *_url / link / href', () => {
    expect(resolveLinkIndex(['name', 'name_url', 'price'])).toBe(1);
    expect(resolveLinkIndex(['title', 'link'])).toBe(1);
    expect(resolveLinkIndex(['a', 'b'])).toBe(-1);
    expect(resolveLinkIndex(['a', 'b'], 'b')).toBe(1);
    expect(resolveLinkIndex(['a', 'b'], 'zzz')).toBe(-1);
  });

  it('hostRelated allows same host and sub/parent domains only', () => {
    expect(hostRelated('shop.example.com', 'example.com')).toBe(true);
    expect(hostRelated('example.com', 'EXAMPLE.com')).toBe(true);
    expect(hostRelated('evilexample.com', 'example.com')).toBe(false);
    expect(hostRelated('example.org', 'example.com')).toBe(false);
  });

  it('uniqueNames suffixes collisions without touching free names', () => {
    expect(uniqueNames(['name', 'price'], ['name', 'weight', 'name', 'detail_status'])).toEqual(['name_d', 'weight', 'name_d3', 'detail_status']);
  });
});

describe('ordered field specs (Chrome sorts object keys across extension APIs)', () => {
  it('pairs keep the requested column order, even when it is not alphabetical', () => {
    page('', '<main><i class="a">A</i><i class="b">B</i><i class="c">C</i></main>');
    const r = detailExtract(document, { fields: [['zeta', { selector: '.c' }], ['alpha', { selector: '.a' }], ['mid', { selector: '.b' }]] });
    expect(r.columns).toEqual(['zeta', 'alpha', 'mid']);
    expect(r.cells).toEqual(['C', 'A', 'B']);
  });

  it('toPairs turns an object into pairs in insertion order and leaves pairs untouched', () => {
    const obj = { z: { selector: '.z' }, a: { selector: '.a' } };
    expect(toPairs(obj)!.map(([n]) => n)).toEqual(['z', 'a']);
    const pairs = toPairs(obj)!;
    expect(toPairs(pairs)).toBe(pairs);
    expect(toPairs(undefined)).toBeUndefined();
  });
});
