import { detect } from './autodetect';
import { clean, clip, deepQueryAll, deepQueryFirst, isHidden, refFor, shortUrl } from './util';

export interface OutlineResult {
  text: string;
  truncated: boolean;
}

const visible = (els: Element[]) => els.filter((e) => !isHidden(e));

function label(el: Element): string {
  return clean(
    el.getAttribute('aria-label') ||
      (el as HTMLInputElement).value ||
      el.textContent ||
      el.getAttribute('title') ||
      '',
  );
}

/** Compact structural digest of the page: headings, forms, tables, buttons, key links. */
export function pageOutline(doc: Document, opts: { maxChars?: number } = {}): OutlineResult {
  const maxChars = opts.maxChars ?? 1800;
  const out: string[] = [];
  const loc = doc.location;
  out.push(`${clean(doc.title) || '(no title)'} — ${loc ? loc.host + loc.pathname : ''}`);

  const headings = visible(deepQueryAll(doc, 'h1,h2,h3,h4'));
  if (headings.length) {
    out.push('## Headings');
    for (const h of headings.slice(0, 40)) {
      const lvl = Number(h.tagName[1]);
      const t = clip(clean(h.textContent), 90).text;
      if (t) out.push(`${'  '.repeat(lvl - 1)}h${lvl} [${refFor(h)}] ${t}`);
    }
    if (headings.length > 40) out.push(`  … +${headings.length - 40} more headings`);
  }

  const forms = visible(deepQueryAll(doc, 'form')).slice(0, 5);
  if (forms.length) {
    out.push('## Forms');
    for (const f of forms) {
      const fields = visible(deepQueryAll(f, 'input,select,textarea'))
        .filter((i) => (i as HTMLInputElement).type !== 'hidden')
        .slice(0, 8)
        .map((i) => {
          const el = i as HTMLInputElement;
          const name = el.name || el.id || el.getAttribute('aria-label') || el.placeholder || el.tagName.toLowerCase();
          return `${name}(${el.type || el.tagName.toLowerCase()}) [${refFor(i)}]`;
        });
      const submit = f.querySelector('button, input[type="submit"]');
      out.push(
        `[${refFor(f)}] form${f.getAttribute('action') ? ' → ' + shortUrl(doc, f.getAttribute('action')) : ''}: ${fields.join(', ')}` +
          (submit ? ` | submit "${clip(label(submit), 30).text}" [${refFor(submit)}]` : ''),
      );
    }
  }

  const tables = visible(deepQueryAll(doc, 'table')).slice(0, 5);
  const lists = detect(doc, { limit: 0 });
  if (tables.length || lists.candidates.length) {
    out.push('## Data');
    for (const t of tables) {
      const tt = t as HTMLTableElement;
      const head = Array.from(tt.rows[0]?.cells ?? []).map((c) => clip(clean(c.textContent), 20).text);
      out.push(`table [${refFor(t)}] ${tt.rows.length} rows: ${head.join(' | ')}`);
    }
    for (const c of lists.candidates.filter((c) => c.kind === 'list').slice(0, 3)) {
      out.push(`repeating list: ${c.rows} rows × cols(${c.columns.slice(0, 6).join(', ')}) row="${c.rowSelector}"`);
    }
    out.push('(use page_extract to read this data)');
  }

  const buttons = visible(deepQueryAll(doc, 'button, [role="button"], input[type="submit"], input[type="button"]'));
  const bl = buttons.map((b) => ({ b, l: label(b) })).filter((x) => x.l).slice(0, 15);
  if (bl.length) {
    out.push('## Buttons');
    for (const { b, l } of bl) out.push(`[${refFor(b)}] "${clip(l, 40).text}"`);
  }

  const main = deepQueryFirst(doc, 'main, [role="main"], article') ?? doc.body;
  const links = visible(deepQueryAll(main, 'a[href]'))
    .map((a) => ({ a, t: clean(a.textContent) || a.getAttribute('aria-label') || '' }))
    .filter((x) => x.t);
  out.push(`## Links (${links.length} in main; first 15)`);
  for (const { a, t } of links.slice(0, 15)) {
    out.push(`[${refFor(a)}] ${clip(t, 50).text} → ${clip(shortUrl(doc, a.getAttribute('href')), 80).text}`);
  }

  const joined = out.join('\n');
  const c = clip(joined, maxChars);
  return { text: c.text, truncated: c.truncated };
}
