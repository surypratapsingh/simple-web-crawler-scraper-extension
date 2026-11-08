import { describe, expect, it } from 'vitest';
import { UNTRUSTED, fmtQuery } from './format';

describe('fmtQuery', () => {
  it('marks page text as untrusted and lists each match with its ref and attributes', () => {
    const out = fmtQuery({
      total: 2,
      returned: 2,
      truncated: false,
      items: [
        { ref: 'e1', tag: 'a', text: 'Docs', attrs: { href: '/docs' } },
        { ref: 'e2', tag: 'button', text: 'Go' },
      ],
    });
    expect(out.split('\n')).toEqual([UNTRUSTED, '[e1] <a> Docs href=/docs', '[e2] <button> Go', '[2 of 2 matches]']);
  });

  it('says when the list was truncated', () => {
    const out = fmtQuery({ total: 50, returned: 1, truncated: true, items: [{ ref: 'e1', tag: 'p', text: 'x' }] });
    expect(out.endsWith('[1 of 50 matches; truncated]')).toBe(true);
  });
});
