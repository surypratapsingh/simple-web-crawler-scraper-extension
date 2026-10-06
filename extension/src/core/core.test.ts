// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { detect, extractFields } from './autodetect';
import { pageOutline } from './outline';
import { pageInfo, pageQuery } from './query';
import { pageText } from './text';
import { cssPath, stableClass } from './util';

const html = readFileSync(resolve(__dirname, '../../../tests/fixtures/shop.html'), 'utf8');

beforeEach(() => {
  document.documentElement.innerHTML = html.replace(/^<!doctype html>\s*<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
});

describe('pageText', () => {
  it('returns readable main text without nav, footer or hidden content', () => {
    const r = pageText(document, { maxChars: 5000 });
    expect(r.text).toContain('# Widgets');
    expect(r.text).toContain('Blue Widget');
    expect(r.text).not.toContain('SECRET PROMO');
    expect(r.text).not.toContain('Copyright Acme');
    expect(r.text).not.toContain('Cart');
  });

  it('renders table cells with separators', () => {
    expect(pageText(document, { maxChars: 5000 }).text).toContain('W-100 | 1.2kg | Blue');
  });

  it('respects the budget and offers a continuation offset', () => {
    const a = pageText(document, { maxChars: 50 });
    expect(a.text.length).toBeLessThanOrEqual(50);
    expect(a.truncated).toBe(true);
    const b = pageText(document, { maxChars: 50, offset: a.nextOffset });
    expect(b.offset).toBe(a.nextOffset);
    expect(b.text).not.toBe(a.text);
  });

  it('reads a specific selector, including boilerplate tags', () => {
    expect(pageText(document, { selector: 'footer' }).text).toContain('Copyright Acme');
    expect(() => pageText(document, { selector: '.nope' })).toThrow(/matched nothing/);
  });
});

describe('detect', () => {
  it('finds the product grid as a repeating list with link and image columns', () => {
    const { best, candidates } = detect(document);
    expect(best).not.toBeNull();
    expect(best!.total).toBe(4);
    expect(best!.columns).toEqual(expect.arrayContaining(['title', 'title_url', 'price', 'stock']));
    const row = best!.rows[0];
    const cols = best!.columns;
    expect(row[cols.indexOf('title')]).toBe('Blue Widget');
    expect(row[cols.indexOf('price')]).toBe('$10.00');
    expect(row[cols.indexOf('title_url')]).toMatch(/\/p\/1$/);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('does not treat the navigation list as data', () => {
    const { candidates } = detect(document);
    expect(candidates.every((c) => !c.rowSelector.includes('nav'))).toBe(true);
  });

  it('detects the specs table with header names', () => {
    const t = detect(document).candidates.find((c) => c.kind === 'table');
    expect(t?.columns).toEqual(['Model', 'Weight', 'Color']);
    expect(t?.rows).toBe(3);
  });

  it('extracts by explicit fields', () => {
    const r = extractFields(document, {
      rowSelector: '.card',
      fields: { name: { selector: '.title' }, url: { selector: '.title', attr: 'href' }, price: { selector: '.price' } },
    });
    expect(r.total).toBe(4);
    expect(r.rows[2][0]).toBe('Green Widget');
    expect(r.rows[2][2]).toBe('$9.99');
  });
});

describe('outline / info / query', () => {
  it('outline summarises structure and stays within budget', () => {
    const o = pageOutline(document, { maxChars: 3000 });
    expect(o.text).toContain('## Headings');
    expect(o.text).toContain('h1');
    expect(o.text).toContain('## Forms');
    expect(o.text).toContain('repeating list: 4 rows');
    expect(o.text).toContain('"Load more"');
    expect(pageOutline(document, { maxChars: 120 }).text.length).toBeLessThanOrEqual(120);
  });

  it('refs from the outline can be queried', () => {
    const o = pageOutline(document);
    const ref = /h1 \[(e\d+)\] Widgets/.exec(o.text)![1];
    const q = pageQuery(document, { ref });
    expect(q.items[0].text).toBe('Widgets');
  });

  it('query by selector returns attrs with absolute urls and honours limit', () => {
    const q = pageQuery(document, { selector: '.card a', attrs: ['href'], limit: 2 });
    expect(q.total).toBe(4);
    expect(q.returned).toBe(2);
    expect(q.truncated).toBe(true);
    expect(q.items[0].attrs!.href).toMatch(/^https?:\/\/.*\/p\/1$/);
  });

  it('info returns cheap counts', () => {
    const i = pageInfo(document);
    expect(i.title).toBe('Acme Shop — Widgets');
    expect(i.h1).toBe('Widgets');
    expect(i.counts.tables).toBe(1);
  });
});

describe('selectors', () => {
  it('rejects generated class names', () => {
    expect(stableClass('product-title')).toBe(true);
    expect(stableClass('css-1x2y3z9')).toBe(false);
    expect(stableClass('Card_title__x7Yz1')).toBe(false);
    expect(stableClass('md:flex')).toBe(false);
  });

  it('cssPath yields a unique selector', () => {
    const el = document.querySelectorAll('.card')[2];
    const sel = cssPath(el);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(el);
  });
});

describe('shadow DOM', () => {
  beforeEach(() => {
    document.body.innerHTML = `<main><h1>Shadow page</h1><div id="host"></div>
      <p>Some ordinary light-DOM paragraph text that is long enough to make this main element count as the primary content region of the page for the heuristics.</p></main>`;
    const host = document.getElementById('host')!;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<ul class="items">' +
      [1, 2, 3, 4].map((i) => `<li class="item"><span class="name">Item ${i}</span><span class="cost">$${i}.00</span></li>`).join('') +
      '</ul><slot></slot>';
    host.innerHTML = '<em>slotted light text</em>';
  });

  it('pageText reads shadow content and slotted light content', () => {
    const t = pageText(document, { maxChars: 4000 }).text;
    expect(t).toContain('Item 1');
    expect(t).toContain('$4.00');
    expect(t).toContain('slotted light text');
    expect(t.match(/slotted light text/g)).toHaveLength(1); // not double-counted
  });

  it('detect finds a repeating list inside a shadow root', () => {
    const { best } = detect(document);
    expect(best).not.toBeNull();
    expect(best!.total).toBe(4);
    expect(best!.columns).toEqual(['name', 'cost']);
    expect(best!.rows[1]).toEqual(['Item 2', '$2.00']);
  });

  it('selectors pierce open shadow roots (query + explicit fields)', () => {
    expect(pageQuery(document, { selector: '.item .name' }).total).toBe(4);
    const r = extractFields(document, {
      rowSelector: best_rowSelector(),
      fields: { n: { selector: '.name' }, c: { selector: '.cost' } },
    });
    expect(r.rows).toHaveLength(4);
    expect(r.rows[3]).toEqual(['Item 4', '$4.00']);
  });

  it('display:contents wrappers are not treated as hidden', () => {
    document.body.innerHTML = '<main><div style="display:contents"><p>Visible via contents wrapper</p></div></main>';
    expect(pageText(document).text).toContain('Visible via contents wrapper');
  });
});

function best_rowSelector(): string {
  return detect(document).best!.rowSelector;
}

describe('detect: short rows', () => {
  it('still finds lists whose rows are only a few characters (name + price)', () => {
    document.body.innerHTML =
      '<main><ul class="p">' +
      [['Lamp', '$20'], ['Desk', '$150'], ['Chair', '$85'], ['Shelf', '$40']]
        .map(([n, p]) => `<li class="product"><span class="n">${n}</span><span class="c">${p}</span></li>`)
        .join('') +
      '</ul></main>';
    const { best } = detect(document);
    expect(best?.rows).toEqual([['Lamp', '$20'], ['Desk', '$150'], ['Chair', '$85'], ['Shelf', '$40']]);
  });

  it('ignores lists of empty / icon-only rows', () => {
    document.body.innerHTML =
      '<main><ul>' + '<li><span class="i"></span><span class="j"></span></li>'.repeat(5) + '</ul></main>';
    expect(detect(document).best).toBeNull();
  });
});

describe('extractFields column order', () => {
  it('accepts ordered pairs and keeps their order', () => {
    const r = extractFields(document, {
      rowSelector: '.card',
      fields: [
        ['price', { selector: '.price' }],
        ['name', { selector: '.title' }],
      ],
    });
    expect(r.columns).toEqual(['price', 'name']);
    expect(r.rows[0]).toEqual(['$10.00', 'Blue Widget']);
  });
});
