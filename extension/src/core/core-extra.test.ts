// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { clean, clip, isSkipped, isHidden, allElements, deepQueryAll, deepQueryFirst, childrenOf, abs, shortUrl, refFor, resolveRef, stableClass, cssPath } from './util';
import { pageOutline } from './outline';
import { pageInfo, pageQuery } from './query';
import { pageText } from './text';
import { pageLinks } from './links';

// Reset DOM before each test so tests are independent.
beforeEach(() => {
  document.body.innerHTML = '<main></main>';
});

describe('util', () => {
  describe('clean', () => {
    it('collapses whitespace and trims', () => {
      expect(clean('  a  b \n c ')).toBe('a b c');
      expect(clean('')).toBe('');
      expect(clean(null)).toBe('');
      expect(clean(undefined)).toBe('');
    });
  });

  describe('clip', () => {
    it('returns text unchanged when short', () => {
      expect(clip('abc', 10)).toEqual({ text: 'abc', truncated: false });
    });
    it('truncates long text and flags truncation', () => {
      const r = clip('abcdefghi', 5);
      expect(r.text).toBe('abcd…');
      expect(r.truncated).toBe(true);
    });
    it('handles empty and very long input', () => {
      expect(clip('', 5)).toEqual({ text: '', truncated: false });
      expect(clip('x'.repeat(10000), 80).text.length).toBeLessThanOrEqual(80);
    });
    it('handles negative max gracefully', () => {
      const r = clip('abc', -1);
      expect(r.text).toBe('…');
      expect(r.truncated).toBe(true);
    });
  });

  describe('isSkipped', () => {
    it('skips configured tags', () => {
      expect(isSkipped(document.createElement('script'))).toBe(true);
      expect(isSkipped(document.createElement('div'))).toBe(false);
      expect(isSkipped(document.createElement('style'))).toBe(true);
    });
  });

  describe('isHidden', () => {
    it('detects hidden and aria-hidden', () => {
      const h = document.createElement('div');
      h.hidden = true;
      expect(isHidden(h)).toBe(true);
      const a = document.createElement('div');
      a.setAttribute('aria-hidden', 'true');
      expect(isHidden(a)).toBe(true);
    });
  });

  describe('allElements', () => {
    it('finds light DOM children then descends into open shadow roots', () => {
      const host = document.createElement('div');
      host.style.display = 'none';
      document.body.appendChild(host);
      const light = document.createElement('span');
      light.textContent = 'light';
      host.append(light);
      const root = host.attachShadow({ mode: 'open' });
      const inner = document.createElement('span');
      inner.textContent = 'shadow';
      root.append(inner);
      expect(allElements(host)).toHaveLength(2);
      document.body.innerHTML = '';
    });
  });

  describe('deepQueryAll / deepQueryFirst', () => {
    it('searches inside shadow roots', () => {
      const host = document.createElement('div');
      host.style.display = 'none';
      document.body.appendChild(host);
      const root = host.attachShadow({ mode: 'open' });
      const span = document.createElement('span');
      span.id = 'inner';
      root.append(span);
      expect(deepQueryAll(host, '#inner')).toHaveLength(1);
      expect(deepQueryFirst(host, '#inner')!.id).toBe('inner');
      document.body.innerHTML = '';
    });
  });

  describe('childrenOf', () => {
    it('shows shadow tree for a shadow host', () => {
      const host = document.createElement('div');
      host.style.display = 'none';
      document.body.appendChild(host);
      const root = host.attachShadow({ mode: 'open' });
      const s = document.createElement('span');
      root.append(s);
      expect(childrenOf(host)).toHaveLength(1);
      document.body.innerHTML = '';
    });
  });

  describe('abs / shortUrl', () => {
    it('returns empty on null/undefined', () => {
      expect(abs(document, null)).toBe('');
      expect(abs(document, undefined)).toBe('');
    });
    it('resolves relative URLs against baseURI', () => {
      expect(abs(document, 'x.png')).toBe('http://localhost:3000/x.png');
    });
    it('returns unreadable url unchanged', () => {
      expect(abs(document, 'http://[::1')).toBe('http://[::1');
    });
    it('shortens same-origin URLs', () => {
      expect(shortUrl(document, '/x.png')).toBe('/x.png');
    });
    it('keeps cross-origin URLs unchanged', () => {
      const cross = 'https://other.com/x.png';
      expect(abs(document, cross)).toBe(cross);
      expect(shortUrl(document, cross)).toBe(cross);
    });
  });

  describe('refFor / resolveRef', () => {
    it('assigns and resolves refs', () => {
      const a = document.createElement('a');
      a.textContent = 'x';
      document.body.appendChild(a);
      const r = refFor(a);
      expect(r).toMatch(/^e\d+$/);
      expect(resolveRef(r)).toBe(a);
      expect(resolveRef('unknown')).toBeNull();
      const b = document.createElement('a');
      document.body.appendChild(b);
      const s = refFor(b);
      expect(s).not.toBe(r);
    });
  });

  describe('stableClass', () => {
    it('accepts stable ASCII classes', () => {
      expect(stableClass('product-title')).toBe(true);
      expect(stableClass('my-menu-item')).toBe(true);
    });
    it('rejects suspicious class names', () => {
      expect(stableClass('css-1x2y3z')).toBe(false);
      expect(stableClass('__x7Yz1')).toBe(false);
      expect(stableClass('_private')).toBe(false);


      expect(stableClass('')).toBe(false);
      expect(stableClass('x'.repeat(33))).toBe(false);
    });
  });

  describe('cssPath', () => {
    it('generates a unique selector', () => {
      const a = document.createElement('a');
      a.id = 'target';
      a.textContent = 'x';
      document.body.appendChild(a);
      expect(document.querySelectorAll(cssPath(a)).length).toBe(1);
      document.body.innerHTML = '';
    });
  });
});

describe('pageOutline', () => {
  it('summarises a page and stays within budget', () => {
    document.body.innerHTML = `
      <h1>Title</h1>
      <form><input name="q"><button>Go</button></form>
      <ul><li><a>one</a></li><li><a>two</a></li></ul>
      <a href="/x">link</a>
    `;
    const o = pageOutline(document, { maxChars: 300 });
    expect(o.text).toContain('Title');
    expect(o.text).toContain('## Forms');
    expect(o.text).toContain('## Links');
    expect(o.truncated).toBe(false);
  });

  it('caps output and marks truncation', () => {
    document.body.innerHTML = '<h1>T</h1>' + Array.from({ length: 30 }, (_, i) => `<p>p${i}</p>`).join('');
    const o = pageOutline(document, { maxChars: 60 });
    expect(o.truncated).toBe(true);
    expect(o.text.length).toBeLessThanOrEqual(60);
  });
});

describe('pageInfo', () => {
  it('returns cheap page stats', () => {
    document.title = 'T';
    document.body.innerHTML = '<h1>H1</h1><a href="/x">l</a><img src="/i.png">';
    const i = pageInfo(document);
    expect(i.title).toBe('T');
    expect(i.h1).toBe('H1');
    expect(i.counts.links).toBe(1);
    expect(i.counts.images).toBe(1);
  });
});

describe('pageQuery', () => {
  it('returns matching elements with optional attrs and a ref', () => {
    document.body.innerHTML = '<a id="a1" href="/1">one</a><a id="a2" href="/2">two</a>';
    const q = pageQuery(document, { selector: 'a', attrs: ['href'], limit: 1 });
    expect(q.total).toBe(2);
    expect(q.returned).toBe(1);
    expect(q.truncated).toBe(true);
    expect(q.items[0].attrs!.href).toMatch(/^https?:\/\//);
    expect(q.items[0].ref).toMatch(/^e\d+$/);
  });

  it('queries by ref with absolute urls', () => {
    document.body.innerHTML = '<h1>T</h1><a id="a1" href="/1">one</a>';
    const o = pageOutline(document);
    const ref = /h1 \[(e\d+)\] T/.exec(o.text)?.[1];
    const q = pageQuery(document, { ref });
    expect(q.items[0].text).toBe('T');
  });

  it('returns empty when no element matches', () => {
    document.body.innerHTML = '<h1>T</h1>';
    const q = pageQuery(document, { selector: '.missing' });
    expect(q.total).toBe(0);
    expect(q.items).toEqual([]);
  });

  it('throws when neither ref nor selector is given', () => {
    expect(() => pageQuery(document, {})).toThrow(/selector or ref/);
  });
});

describe('pageText', () => {
  it('returns readable text, skipping hidden and boilerplate', () => {
    document.body.innerHTML = `
      <nav>nav</nav>
      <main id="m"><main>
        <p>main text</p>
      </main>
      <footer>footer</footer>
    `;
    const t = pageText(document, { maxChars: 500 });
    expect(t.text).toContain('main text');
    expect(t.text).not.toContain('nav');
    expect(t.text).not.toContain('footer');
  });

  it('respects offset and budget', () => {
    document.body.innerHTML = '<main>' + Array.from({ length: 5 }, (_, i) => `<p>p${i}</p>`).join('') + '</main>';
    const a = pageText(document, { maxChars: 10 });
    expect(a.text.length).toBeLessThanOrEqual(10);
    expect(a.truncated).toBe(true);
    const b = pageText(document, { maxChars: 10, offset: a.nextOffset });
    expect(b.offset).toBe(a.nextOffset);
    expect(b.text).not.toBe(a.text);
  });

  it('throws for a missing selector', () => {
    expect(() => pageText(document, { selector: '.nope' })).toThrow(/matched nothing/);
  });
});

describe('pageLinks', () => {
  it('returns unique http(s) links, skipping mailto/tel/js', () => {
    document.body.innerHTML = `
      <a href="/a">a</a>
      <a href="/a">dup</a>
      <a href="mailto:x@y.com">mail</a>
      <a href="tel:+1">call</a>
      <a href="javascript:alert(1)">js</a>
      <a href="/img.png">img</a>
    `;
    const links = pageLinks(document);
    expect(links).toContain('http://localhost:3000/a');
    expect(links).toHaveLength(1);
  });
});
