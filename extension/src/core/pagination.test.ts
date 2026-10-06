// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { detect } from './autodetect';
import { clickRef, contentSig, findNext, isDenied, waitChange, waitStable } from './pagination';

const set = (html: string) => {
  document.body.innerHTML = html;
};

describe('findNext', () => {
  beforeEach(() => set(''));

  it('prefers rel=next and returns an absolute link', () => {
    set('<a href="/other">Other</a><a rel="next" href="/list?page=2">whatever</a>');
    const n = findNext(document)!;
    expect(n.kind).toBe('link');
    expect(n.href).toMatch(/\/list\?page=2$/);
    expect(n.via).toBe('rel');
  });

  it('recognises common "next" labels and glyphs', () => {
    for (const label of ['Next', 'Next page', 'Next ›', '›', '»', 'Older posts', 'Load more']) {
      set(`<button type="button">${label}</button>`);
      expect(findNext(document), label).not.toBeNull();
    }
    set('<a href="/p2" aria-label="Go to next page">2</a>');
    expect(findNext(document)?.kind).toBe('link');
  });

  it('a "#"/javascript link or a button is a click target with a ref', () => {
    set('<a href="#" class="n">Next</a>');
    const n = findNext(document)!;
    expect(n.kind).toBe('click');
    expect(n.ref).toMatch(/^e\d+$/);
  });

  it('skips disabled controls (last page) including Bootstrap-style li.disabled', () => {
    set('<ul class="pagination"><li class="page-item disabled"><a class="page-link" href="/p6">Next</a></li></ul>');
    expect(findNext(document)).toBeNull();
    set('<button disabled>Next</button>');
    expect(findNext(document)).toBeNull();
    set('<a href="/x" aria-disabled="true">Next</a>');
    expect(findNext(document)).toBeNull();
  });

  it('never picks a form submit button heuristically', () => {
    set('<form action="/buy"><button>Next</button></form>');
    expect(findNext(document)).toBeNull();
    set('<form><input type="submit" value="Next"></form>');
    expect(findNext(document)).toBeNull();
  });

  it('prefers a control inside a pagination container', () => {
    set('<a href="/promo">Next</a><nav aria-label="Pagination"><a href="/list?page=3">Next</a></nav>');
    expect(findNext(document)!.href).toMatch(/page=3$/);
  });

  it('falls back to the link after the current page in a numbered pager', () => {
    set('<ul class="pagination"><li><a href="/p1">1</a></li><li class="active"><a href="/p2">2</a></li><li><a href="/p3">3</a></li><li><a href="/p4">4</a></li></ul>');
    expect(findNext(document)!.href).toMatch(/p3$/);
    expect(findNext(document)!.via).toBe('numbered');
  });

  it('returns null when nothing looks like pagination', () => {
    set('<a href="/about">About</a><button>Buy now</button>');
    expect(findNext(document)).toBeNull();
  });

  it('honours an explicit selector but refuses destructive labels', () => {
    set('<button class="go">Show more</button><button class="del">Delete account</button>');
    expect(findNext(document, { selector: '.go' })!.kind).toBe('click');
    expect(() => findNext(document, { selector: '.del' })).toThrow(/destructive/);
    expect(findNext(document, { selector: '.missing' })).toBeNull();
  });

  it('clickRef clicks the element and refuses destructive ones', () => {
    set('<button id="b">Next</button><button id="d">Buy now</button>');
    let clicked = 0;
    document.getElementById('b')!.addEventListener('click', () => clicked++);
    const t = findNext(document, { selector: '#b' })!;
    clickRef(document, t.ref!);
    expect(clicked).toBe(1);
    expect(isDenied(document.getElementById('d')!)).toBe(true);
  });
});

describe('waiting helpers', () => {
  it('contentSig changes when content changes', () => {
    set('<main><p>one two three, enough words to matter</p></main>');
    const a = contentSig(document);
    document.querySelector('p')!.textContent = 'different content now';
    expect(contentSig(document)).not.toBe(a);
  });

  it('waitChange resolves true when the DOM changes, false on timeout', async () => {
    set('<main><p>start</p></main>');
    const before = contentSig(document);
    setTimeout(() => (document.querySelector('p')!.textContent = 'changed later'), 100);
    expect((await waitChange(document, { before, timeoutMs: 1500 })).changed).toBe(true);
    expect((await waitChange(document, { before: contentSig(document), timeoutMs: 300 })).changed).toBe(false);
  });

  it('waitStable waits for a burst of mutations to finish', async () => {
    set('<main id="m"></main>');
    let n = 0;
    const iv = setInterval(() => {
      document.getElementById('m')!.append(document.createElement('i'));
      if (++n >= 5) clearInterval(iv);
    }, 60);
    const r = await waitStable(document, { quietMs: 200, timeoutMs: 3000 });
    expect(r.settled).toBe(true);
    expect(document.querySelectorAll('#m i')).toHaveLength(5);
  });
});

describe('detect prefer', () => {
  it('only returns the candidate with the preferred rowSelector', () => {
    set(
      '<main><ul class="a">' + '<li class="x"><b>alpha</b><i>value1</i></li>'.repeat(4) + '</ul>' +
        '<ul class="b">' + '<li class="y"><b>bravo</b><i>value2</i><u>extra</u></li>'.repeat(6) + '</ul></main>',
    );
    const auto = detect(document);
    const other = auto.candidates.find((c) => c.rowSelector !== auto.best!.rowSelector)!;
    expect(detect(document, { prefer: other.rowSelector }).best?.rowSelector).toBe(other.rowSelector);
    expect(detect(document, { prefer: 'ul.nope > li' }).best).toBeNull();
  });
});
