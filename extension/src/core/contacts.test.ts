// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { listImages, scanContacts } from './contacts';

const set = (html: string) => (document.body.innerHTML = html);
beforeEach(() => set(''));

describe('scanContacts: emails', () => {
  it('reads mailto links and emails in body text, case-insensitively de-duped', () => {
    set('<a href="mailto:Sales@Example.com">Sales</a><p>Contact us at sales@example.com or support@example.org.</p>');
    expect(scanContacts(document).emails).toEqual(['sales@example.com', 'support@example.org']);
  });

  it('catches a light "(at)/(dot)" obfuscation on short lines only', () => {
    set('<p>me (at) example (dot) com</p>');
    expect(scanContacts(document).emails).toEqual(['me@example.com']);
    set(`<p>${'x'.repeat(210)} (at) example (dot) com</p>`); // too long a line: not scanned
    expect(scanContacts(document).emails).toEqual([]);
  });

  it('ignores mailto with a query string suffix', () => {
    set('<a href="mailto:a@b.com?subject=Hi">mail</a>');
    expect(scanContacts(document).emails).toEqual(['a@b.com']);
  });
});

describe('scanContacts: phones', () => {
  it('reads tel: links verbatim and formatted numbers from text', () => {
    set('<a href="tel:+1-555-123-4567">Call</a><p>Or reach the office at (415) 555-0100.</p>');
    const r = scanContacts(document);
    expect(r.phones).toContain('+1-555-123-4567');
    expect(r.phones.some((p) => p.includes('415'))).toBe(true);
  });

  it('does not treat a bare id-like digit run or an ISO date as a phone number', () => {
    set('<p>Order number 20260921083045 was placed on 2026-09-21.</p>');
    expect(scanContacts(document).phones).toEqual([]);
  });
});

describe('scanContacts: social links', () => {
  it('recognises known platforms, resolves relative links, and de-dupes', () => {
    set(
      '<a href="https://x.com/acme">X</a><a href="/away?to=https://instagram.com/acme">insta via redirect text is not followed</a>' +
        '<a href="https://www.linkedin.com/company/acme/">LinkedIn</a><a href="https://linkedin.com/company/acme">dup</a>',
    );
    const r = scanContacts(document);
    expect(r.social).toEqual(
      expect.arrayContaining([
        { platform: 'x', url: 'https://x.com/acme' },
        { platform: 'linkedin', url: 'https://www.linkedin.com/company/acme/' },
      ]),
    );
    expect(r.social).toHaveLength(2); // the linkedin dup (different subdomain, same path) collapses by origin+path... see below
  });

  it('filters out the platform\'s own generic pages and bare homepages', () => {
    set('<a href="https://facebook.com/sharer/sharer.php?u=x">Share</a><a href="https://twitter.com/">Twitter home</a><a href="https://youtube.com/watch?v=1">video, not a channel</a>');
    expect(scanContacts(document).social).toEqual([]);
  });
});

describe('listImages', () => {
  it('resolves absolute src, skips data URIs and tiny/icon-sized images, and de-dupes', () => {
    set(
      '<img src="/a.jpg" width="400" height="300" alt="A"><img src="data:image/png;base64,xx">' +
        '<img src="/icon.png" width="10" height="10"><img src="/a.jpg" width="400" height="300">',
    );
    const imgs = listImages(document);
    expect(imgs).toEqual([{ src: expect.stringMatching(/\/a\.jpg$/), alt: 'A', width: 400, height: 300 }]);
  });

  it('falls back to data-src for lazy-loaded images and keeps images with unknown size', () => {
    set('<img data-src="/lazy.jpg" alt="Lazy">');
    expect(listImages(document)).toEqual([{ src: expect.stringMatching(/\/lazy\.jpg$/), alt: 'Lazy', width: 0, height: 0 }]);
  });
});
