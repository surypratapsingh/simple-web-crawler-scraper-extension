import { describe, expect, it } from 'vitest';
import { alignRows, buildUrl, hostRelated, jitter, pageLimit, parseRobots, robotsAllows, rowKey } from './crawl-util';

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

describe('crawl depth limit', () => {
  it('defaults to 5 pages and never goes past the hard cap', () => {
    expect(pageLimit()).toBe(5);
    expect(pageLimit(20)).toBe(20);
    expect(pageLimit(100)).toBe(100);
    expect(pageLimit(1)).toBe(1);
    expect(pageLimit(0)).toBe(0);
  });

  it('clamps a request deeper than the cap, including a custom cap', () => {
    expect(pageLimit(101)).toBe(100);
    expect(pageLimit(5000)).toBe(100);
    expect(pageLimit(50, 10)).toBe(10);
  });
});

describe('same-origin limit', () => {
  it('accepts the same host and its subdomains in either direction', () => {
    expect(hostRelated('example.com', 'example.com')).toBe(true);
    expect(hostRelated('www.example.com', 'example.com')).toBe(true);
    expect(hostRelated('example.com', 'shop.example.com')).toBe(true);
    expect(hostRelated('EXAMPLE.com', 'Example.COM')).toBe(true);
  });

  it('rejects other hosts and names that only share a fragment', () => {
    expect(hostRelated('evil.com', 'example.com')).toBe(false);
    expect(hostRelated('evil-example.com', 'example.com')).toBe(false);
    expect(hostRelated('notexample.com', 'example.com')).toBe(false);
    expect(hostRelated('example.com.evil.net', 'example.com')).toBe(false);
    expect(hostRelated('example.org', 'example.com')).toBe(false);
  });
});
