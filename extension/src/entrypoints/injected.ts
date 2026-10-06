import { detect, extractFields } from '../core/autodetect';
import { listImages, scanContacts } from '../core/contacts';
import { detailExtract } from '../core/detail';
import { pageLinks } from '../core/links';
import { pageOutline } from '../core/outline';
import { clickRef, contentSig, findNext, waitChange, waitStable } from '../core/pagination';
import { pageInfo, pageQuery, pageScroll } from '../core/query';
import { pageText } from '../core/text';

// Injected on demand by the background worker (chrome.scripting.executeScript files: ['/injected.js']).
// Runs in the extension's isolated world; re-injection just refreshes the API object.
export default defineUnlistedScript(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrap = (fn: (a: any) => unknown) => async (args?: unknown) => {
    try {
      return await fn(args ?? {});
    } catch (e) {
      return { __error: e instanceof Error ? e.message : String(e) };
    }
  };
  (window as unknown as { __scrapeline: unknown }).__scrapeline = {
    info: wrap(() => pageInfo(document)),
    outline: wrap((a) => pageOutline(document, a)),
    text: wrap((a) => pageText(document, a)),
    query: wrap((a) => pageQuery(document, a)),
    scroll: wrap((a) => pageScroll(document, a)),
    detect: wrap((a) => detect(document, a)),
    extractFields: wrap((a) => extractFields(document, a)),
    detail: wrap((a) => detailExtract(document, a)),
    contacts: wrap(() => scanContacts(document)),
    images: wrap((a) => ({ images: listImages(document, a) })),
    links: wrap(() => ({ links: pageLinks(document) })),
    // crawler support
    findNext: wrap((a) => findNext(document, a)),
    click: wrap((a) => clickRef(document, a.ref)),
    waitStable: wrap((a) => waitStable(document, a)),
    waitChange: wrap((a) => waitChange(document, a)),
    sig: wrap(() => ({ sig: contentSig(document) })),
  };
});
