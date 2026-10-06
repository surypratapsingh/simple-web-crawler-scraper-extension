import { describe, expect, it } from 'vitest';
import { alignRows, buildUrl, jitter, parseRobots, robotsAllows, rowKey } from './crawl-util';

describe('crawl-util', () => {
  it('rowKey distinguishes rows that would collide when naively joined', () => {
    expect(rowKey(['a', 'bc'])).not.toBe(rowKey(['ab', 'c']));
    expect(rowKey(['a', 'b'])).toBe(rowKey(['a', 'b']));
  });

  it('alignRows reorders by name and pads missing columns', () => {
    expect(alignRows(['b', 'a'], ['a', 'b'], [['2', '1']])).toEqual([['1', '2']]);
    expect(alignRows(['a'], ['a', 'b'], [['1']])).toEqual([['1', '']]);
    const same = [['1', '2']];
    expect(alignRows(['a', 'b'], ['a', 'b'], same)).toBe(same);
  });

  it('buildUrl substitutes every {n}', () => {
    expect(buildUrl('https://x/list?page={n}&p={n}', 3)).toBe('https://x/list?page=3&p=3');
  });

  it('jitter stays within +50%', () => {
    expect(jitter(1000, () => 0)).toBe(1000);
    expect(jitter(1000, () => 1)).toBe(1500);
  });
});

describe('robots.txt', () => {
  const txt = `
# comment
User-agent: *
Disallow: /private
Disallow: /search$
Allow: /private/public
Disallow: /*.pdf$

User-agent: badbot
Disallow: /
`;
  const rules = parseRobots(txt);

  it('applies the * group when no specific group matches', () => {
    expect(robotsAllows(rules, '/catalog?page=2')).toBe(true);
    expect(robotsAllows(rules, '/private/x')).toBe(false);
  });

  it('longest match wins, so Allow can carve out an exception', () => {
    expect(robotsAllows(rules, '/private/public/page')).toBe(true);
  });

  it('supports $ anchors and * wildcards', () => {
    expect(robotsAllows(rules, '/search')).toBe(false);
    expect(robotsAllows(rules, '/search?q=1')).toBe(true); // $ anchors the end
    expect(robotsAllows(rules, '/docs/a.pdf')).toBe(false);
    expect(robotsAllows(rules, '/docs/a.pdf?x=1')).toBe(true);
  });

  it('uses a specific group when our agent name matches it', () => {
    const r = parseRobots(txt, 'badbot/1.0');
    expect(robotsAllows(r, '/anything')).toBe(false);
  });

  it('an empty or missing file allows everything; empty Disallow allows all', () => {
    expect(robotsAllows(parseRobots(''), '/x')).toBe(true);
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow:'), '/x')).toBe(true);
  });
});
