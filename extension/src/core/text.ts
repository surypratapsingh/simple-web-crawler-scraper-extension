import { clean, deepQueryAll, deepQueryFirst, isHidden, isSkipped } from './util';

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN',
  'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TR', 'UL', 'DETAILS', 'SUMMARY',
]);
const BOILERPLATE = new Set(['NAV', 'FOOTER', 'ASIDE']);

export interface TextOpts {
  maxChars?: number;
  offset?: number;
  selector?: string;
}

export interface TextResult {
  text: string;
  /** Total characters available from this root (before offset/maxChars). */
  total: number;
  offset: number;
  truncated: boolean;
  nextOffset?: number;
  root: string;
}

/** Rendered children: a shadow host shows its shadow tree; a <slot> shows what is assigned to it. */
function nodesOf(el: Element): Node[] {
  if (el.tagName === 'SLOT') {
    const assigned = (el as HTMLSlotElement).assignedNodes?.({ flatten: true }) ?? [];
    return assigned.length ? assigned : Array.from(el.childNodes);
  }
  return Array.from((el.shadowRoot ?? el).childNodes);
}

function pickRoot(doc: Document): Element {
  const cands = deepQueryAll(doc, 'main, [role="main"], article').filter((e) => !isHidden(e));
  let best: Element | null = null;
  let bestLen = 0;
  for (const c of cands) {
    const len = clean(c.textContent).length;
    if (len > bestLen) {
      best = c;
      bestLen = len;
    }
  }
  return best && bestLen >= 200 ? best : doc.body;
}

/** Readable text of the page (or a subtree), newline-separated blocks, budgeted. */
export function pageText(doc: Document, opts: TextOpts = {}): TextResult {
  const maxChars = opts.maxChars ?? 1500;
  const offset = Math.max(0, opts.offset ?? 0);
  let root: Element;
  let explicit = false;
  if (opts.selector) {
    const found = deepQueryFirst(doc, opts.selector);
    if (!found) throw new Error(`selector matched nothing: ${opts.selector}`);
    root = found;
    explicit = true;
  } else {
    root = pickRoot(doc);
  }

  const lines: string[] = [];
  let buf = '';
  const flush = () => {
    const t = clean(buf);
    if (t) lines.push(t);
    buf = '';
  };

  const walk = (el: Element, isRoot: boolean) => {
    if (isSkipped(el)) return;
    const tag = el.tagName.toUpperCase();
    if (!isRoot && !explicit && BOILERPLATE.has(tag)) return;
    if (isHidden(el)) return;
    const block = BLOCK.has(tag);
    if (block) flush();
    if (tag === 'BR') {
      flush();
      return;
    }
    if (/^H[1-6]$/.test(tag)) buf += '#'.repeat(Number(tag[1])) + ' ';
    else if (tag === 'LI') buf += '- ';
    else if ((tag === 'TD' || tag === 'TH') && clean(buf)) buf += ' | ';
    for (const child of nodesOf(el)) {
      if (child.nodeType === 3) buf += child.nodeValue ?? '';
      else if (child.nodeType === 1) walk(child as Element, false);
    }
    if (block) flush();
  };
  walk(root, true);
  flush();

  const full = lines.join('\n');
  const slice = full.slice(offset, offset + maxChars);
  const end = offset + slice.length;
  const truncated = end < full.length;
  const rootName = root === doc.body ? 'body' : root.tagName.toLowerCase();
  return {
    text: slice,
    total: full.length,
    offset,
    truncated,
    nextOffset: truncated ? end : undefined,
    root: rootName,
  };
}
