# Ultimate Web Scraper Extension — Full Plan

Working name: **Scrapeline** (placeholder; rename freely)
Last updated: 2026-09-21

---

## 1. Product thesis

> A **local-first, AI-assisted, recipe-based scraper that lives in your browser**, uses *your* logged-in session, and lets you graduate from "one-click table grab" to scheduled, multi-page, integrated pipelines — without ever needing a server.

Why this can win against Instant Data Scraper, Web Scraper (webscraper.io), Thunderbit, Simplescraper, Data Miner:

| Gap in existing tools | Our answer |
|---|---|
| Free one-click tools stop at simple tables/pagination | **Three modes in one UI**: Auto (1 click) → Guided (point & click) → Recipe (full control) |
| Selector tools break when sites change | **Self-healing selectors**: store multiple anchors + sample values, re-locate automatically, alert on drift |
| AI scrapers send your data to their cloud and charge per page | **Local-first AI**: Chrome built-in Gemini Nano where available, or BYO API key. No mandatory backend |
| Extension scrapers can't be automated from outside | **Bridge**: native-messaging host + CLI + MCP server so scripts and AI agents can run recipes |
| Recipes locked inside one tool | **Open recipe format** (JSON Schema), exportable to Playwright / Crawlee code |

Non-goals (deliberate):
- No CAPTCHA solving, fingerprint spoofing, proxy rotation, or stealth/anti-detection. The extension runs as the user in their own browser at human-plausible rates. This also keeps us inside Chrome Web Store policy.
- No bypassing logins/paywalls. It only sees what the user's session already sees.
- No mandatory cloud, accounts, or telemetry.

## 2. Assumptions (change these and the plan shifts)

1. **Chrome/Edge first (Chromium MV3)**, Firefox second, Safari deferred.
2. Solo dev or 2-person team; estimates below assume ~1 full-time engineer.
3. Freemium business model, but everything core works free and offline.
4. TypeScript everywhere.

## 3. Verified platform facts (checked 2026-09-21)

These drive architecture decisions.

- **MV3 service worker**: terminates after **30 s idle**; a single event over **5 min**, or a `fetch()` response taking over **30 s**, also kills it. Timers reset on extension API calls (Chrome 110+), offscreen-document messages (109+), open ports (114+), active WebSocket messages (116+), and native-messaging connections (105+). → Never hold job state in memory; persist everything and make the crawler resumable.
- **Offscreen documents**: only **one per profile**; only `chrome.runtime` is available inside; reasons include `DOM_PARSER`, `DOM_SCRAPING`, `BLOBS`, `WORKERS`. No auto-close except for audio. → Use for HTML parsing/export blob building, not for orchestration.
- **Firefox MV3** uses **event pages** (not service workers), has **no `chrome.offscreen`** (background page already has DOM), uses `sidebar_action` instead of `side_panel`, and supports `optional_host_permissions` since Firefox 128.
- **Chrome built-in AI**: Prompt API is stable for web pages (138+) and fully available to extensions, with `responseConstraint` (JSON Schema structured output) and image/audio input. Needs ~**22 GB free disk** and 16 GB RAM or a >4 GB VRAM GPU, so it must be **optional**, never required. Summarizer, Translator, Language Detector, Proofreader are stable; Writer/Rewriter are in origin trial.
- **Chrome Web Store policy (enforced from 2026-08-01)**: collected user data must be *strictly necessary to the single disclosed purpose*, all collection prominently disclosed, and practice changes proactively disclosed. Extensions circumventing AI services' guardrails are prohibited. → Keep data local by default; any cloud/LLM send is explicit, per-provider opt-in with a visible disclosure.
- **Framework**: **WXT** is the recommended default in 2026 (Vite-based, cross-browser builds, actively shipping). Plasmo's core was last released May 2025 and is marked alpha, so avoid it.
- **Playwright** can load MV3 extensions only via `launchPersistentContext` with `--load-extension`, and headless requires `channel: 'chromium'` (branded Chrome/Edge removed the side-load flags).

Sources: Chrome for Developers (service worker lifecycle, offscreen API, Prompt API, CWS policy update 2026), MDN/Firefox Extension Workshop, WXT docs, Playwright docs.

## 4. Feature map (tiered)

### Tier 0 — "Instant" (the 10-second win)
- One-click **auto-detect**: tables, repeating lists/cards, product grids, search results, definition lists.
- Auto-detect **pagination**: next button, numbered pages, URL param patterns, "load more", infinite scroll.
- Live preview table, column rename/reorder/delete, dedupe.
- Export: CSV, XLSX, JSON, NDJSON, clipboard (TSV for pasting into Sheets).

### Tier 1 — "Guided" (point & click)
- Element picker overlay with hover highlight, shadow-DOM and same-origin iframe support.
- Field types: text, HTML, attribute, link (absolute URL), image URL, number/price (locale-aware), date (normalized ISO), table, JSON-LD / microdata / OpenGraph, `<meta>`.
- **Robust selector generator**: ranks candidates (data-* / aria / stable ids → semantic classes → structural), rejects hashed/generated classes (e.g. `css-1x2y3z`), shows match count live.
- Row-container detection: click two example rows → infer the repeating pattern.
- Transform pipeline per field: trim, regex extract, replace, split, parse number/date/currency, lowercase, absolute-URL, custom JS (sandboxed).
- Visual validation: highlight matches, flag empty/duplicate/inconsistent fields.

### Tier 2 — "Recipes" (multi-page crawling)
- Recipe = start URLs + page types + selectors + navigation + output schema.
- Navigation: pagination, click-to-expand, scroll-to-load, follow link → detail page, nested lists (parent/child rows joined).
- URL generators: ranges (`?page=[1-50]`), lists, CSV import, sitemap.xml import.
- Job control: pause/resume/cancel, per-domain concurrency (default 1–2), delay with jitter, retry with exponential backoff, resume after browser restart.
- Politeness defaults: rate limits, honors `Retry-After`, optional robots.txt check (warn by default, user-configurable), stops on repeated 403/429.
- Run history, diffs between runs (new/changed/removed rows), per-run logs.

### Tier 3 — "AI"
- **"Describe what you want"** → schema + selectors proposed against the live page; user approves.
- **Self-healing**: on selector failure, re-locate using stored sample values, text, attributes, DOM neighbors; propose a fix, never silently change data.
- **Unstructured → structured** extraction (per-page LLM with JSON-schema output) as an explicit fallback, with cost estimate before running.
- Enrichment steps: classify, summarize, translate, normalize (opt-in per field).
- Providers: Chrome built-in (local), Anthropic / OpenAI / Gemini / Ollama (BYO key, stored locally, encrypted with a user passphrase optionally).

### Tier 4 — "Automation & integrations"
- Scheduling via `chrome.alarms` (min 30 s granularity; realistic use is hourly/daily) with "browser must be open" made explicit in the UI.
- Destinations: file download, Google Sheets, Notion, Airtable, webhook (POST JSON), S3-compatible, local folder (File System Access API).
- **Bridge**: native-messaging host → CLI (`scrapeline run recipe.json --out data.ndjson`) and **MCP server** so Claude/agents can list recipes, run them, and read results.
- **Recipe export** to Playwright script and Crawlee project for server-side scale-up.

### Tier 5 — "Ecosystem" (later)
- Recipe library / sharing (signed, versioned, reviewed; no remote code).
- Optional encrypted sync of recipes (not scraped data) across devices.
- Team workspaces, shared recipes, usage limits (paid).

---

## 5. Core pillar: cheap eyes for Claude (MCP) — *supersedes the Tier 4 "bridge" item; ships in M1*

Goal: let Claude (Claude Code, Claude Desktop, any MCP client) see the web **through your real browser and logged-in sessions** at a fraction of the token cost of screenshots or raw DOM dumps.

Principles
1. **Pre-digest locally.** The extension does the heavy lifting (outline, readable text, table/list detection); Claude receives small structured payloads.
2. **Cost ladder.** Cheapest call first, escalate only if needed:
   `list_tabs` (~10 tok/tab) → `page_info` (~50) → `page_outline` (~300) → `page_text` (budgeted, default 1500) → `page_extract` (rows as compact JSON) → `page_query` (targeted selector read). Screenshots are out of scope for the MVP.
3. **Hard budgets.** Every tool takes `maxChars`; output says when it truncated and how to get more.
4. **Stable refs.** Outline items and interactive elements get short refs (`e12`) reusable in follow-up calls.
5. **Read-only by default.** Actions (scroll, open URL) are limited and logged; clicking/typing is *not* in the MVP.
6. **Human in control.** Popup kill switch ("Claude eyes: ON/OFF"), audit log of every call, per-site block list.

MVP tools: `browser_status`, `list_tabs`, `page_info`, `page_outline`, `page_text`, `page_query`, `page_extract` (auto-detect or explicit fields), `page_scroll`, `open_url` (background tab).
Later: `page_diff` (only what changed since last look), `watch_page`, `run_recipe`, `list_recipes`, `read_results`.

"Other tools too": the same bridge is exposed as (a) MCP over stdio for Claude and other MCP clients (Cursor, etc.), (b) a small CLI (`scrapeline`), and later (c) native-messaging for autostart.

## 6. Architecture

```
Claude / MCP client ──stdio──▶ MCP server (Node)
                                   │  first instance = hub; later instances relay to hub
                                   ▼
                        ws://127.0.0.1:<port>  (token + Origin check)
                                   ▼
                    Extension service worker (WS client, auto-reconnect,
                    persists state; WS traffic keeps SW alive, Chrome 116+)
                                   ▼  chrome.scripting.executeScript
                    Injected script in tab (snapshot / autodetect / extract)
```

Security model (local-only)
- Bind `127.0.0.1` only; random shared token in `~/.scrapeline/token`; reject WS upgrades whose `Origin` is not `chrome-extension://<expected id>` when configured.
- Extension ignores calls when the kill switch is off; restricted URLs (`chrome://`, web store) are refused.
- Scraped page content is **untrusted data**: tool results are wrapped/labelled so prompt-injection text on a page is never treated as instructions; the MCP server description says so.
- No remote code; no eval in extension pages.

## 7. Stack & repo layout

WXT + TypeScript (extension) · Node + `@modelcontextprotocol/sdk` + `ws` + `zod` (server) · Vitest (unit) · Playwright (E2E).

```
webscraper_ex/
  PLAN.md
  packages/protocol/   shared types
  extension/           WXT app: background, injected script, popup
  mcp-server/          MCP stdio server + WS hub/relay
  tests/               e2e (Playwright + fixture site)
```

## 8. Roadmap

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 Foundations** | Repo, WXT scaffold, CI, lint/format | Extension builds and loads |
| **M1 Eyes** | WS bridge, MCP server, snapshot/outline/text/query/extract/scroll/open_url, popup switch + audit log | Claude Code lists tabs and reads a page via MCP; E2E green |
| **M2 Guided scrape** | Element picker, selector generator, live preview, export CSV/JSON/XLSX | Build a scraper without code on 5 fixture sites |
| **M3 Recipes** | Pagination, detail-page follow, job queue in IndexedDB, resume, politeness | 500-page crawl survives SW restarts |
| **M4 AI** | Describe-to-schema, self-healing, built-in AI + BYO key | Heals a mutated fixture site |
| **M5 Integrations** | Sheets/Notion/webhook, scheduling, Playwright/Crawlee export, `page_diff` | Scheduled run delivers to a webhook |
| **M6 Store launch** | Firefox build, privacy policy, optional host permissions, listing | Approved on CWS + AMO |

## 9. Testing strategy

- **Unit (Vitest + DOM env):** outline, text extraction with budgets, list/table auto-detect, selector generation, transforms, protocol validation.
- **Bridge integration:** MCP server against a fake extension WS client (auth, relay, timeouts, reconnect).
- **E2E (Playwright, `channel: 'chromium'`, persistent context):** load built extension, local fixture site, real MCP client over stdio calling tools end-to-end.
- **Resilience:** kill/restart service worker mid-job; websites with shadow DOM, iframes, infinite scroll, hashed classes.
- **Regression fixtures:** saved HTML snapshots of real-world layouts; mutation tests for self-healing.

## 10. Risks & open questions

| Risk | Mitigation |
|---|---|
| Web Store review of broad host access | `activeTab` + optional host permissions in store build; `<all_urls>` only in the local dev build |
| Prompt injection from scraped pages | Label results as untrusted; read-only tools; no click/type in MVP |
| SW termination mid-job | Persist queue; WS keepalive; resumable steps |
| ToS/legal exposure for users | Polite defaults, robots.txt warnings, clear responsible-use notice |
| Built-in AI hardware needs (22 GB disk) | Always optional; BYO key fallback |

Open questions: final name; Firefox priority; whether to add native messaging for autostart; monetization boundaries.

---

## 11. Status (2026-09-21)

**M0 + M1 are built and tested** (see [README.md](README.md) for setup).

| Area | State |
|---|---|
| Extension (WXT/MV3): WS client, dispatcher, injected extractor, popup (kill switch, port/token, block list, audit log) | done |
| MCP server: hub/relay bridge, 9 tools, untrusted-content framing, token + origin checks | done |
| Unit tests (Vitest + jsdom): extraction core (14) + bridge/format (13) | 27 passing |
| E2E (Playwright, real Chromium + built extension + real MCP client over stdio) | 20 passing |

Known limitations / next steps
- **Reconnect latency**: if the service worker is killed while disconnected, recovery waits for the 30 s `chrome.alarms` tick (measured ~27 s in E2E). Native messaging would remove this.
- Top frame only (no iframes / shadow DOM piercing yet) — M2.
- No click/type tools by design; add behind an explicit per-site opt-in if needed.
- Dev build uses `<all_urls>`; store build must move to `activeTab` + optional host permissions (M6).
- Not yet exercised against a real Claude Code / Claude Desktop session (only a real MCP client over stdio).
- Token costs are enforced as character budgets in tests (page_info < 600 chars, outline < 2500), not measured in model tokens.
- Windows quirk: Playwright's Chromium fails SxS activation from `%LOCALAPPDATA%\ms-playwright` in this environment; E2E uses a copy at `.browsers/chrome-win64` (or `SCRAPELINE_CHROMIUM`).

### 11.1 M2-lite shipped (2026-09-21)

Prioritised for "eyes for Claude" over the human-facing picker UI (deferred).

- Open **shadow DOM** support across text, outline, extraction and selectors (`display:contents` no longer counts as hidden).
- **Iframes** (incl. cross-origin): `page_outline` lists frames; `frameId` targets one; block list applies to frames.
- **Export**: `page_extract saveAs csv|json|ndjson` to a confined exports dir (no traversal, no overwrite, CSV formula-injection guard); >500 rows requires `saveAs`.
- Tests: 38 unit (Vitest/jsdom) + 27 E2E (real Chromium, cross-origin frames via a second origin, real web component, export files on disk).
- Bugs found by tests along the way: literal U+FFFF in bundle rejected by Chrome; refs lost on re-injection; detection threshold too strict for short rows.

Still open: point-and-click picker, XLSX export, multi-page/pagination crawling (M3), live run against the user's real Chrome + Claude session.

### 11.2 M3 shipped (2026-09-21): multi-page crawling

- **Engine** (`extension/src/bg/crawler.ts`): persisted job per crawl (meta + per-page row chunks in `chrome.storage.local`), resumable after worker kill, cancellable, one at a time.
- **Pagination strategies**: `rel=next` / "Next"-style links and buttons (prefers pagination containers, numbered-pager fallback, skips disabled/last-page, never form-submit buttons), `{n}` URL templates, click-driven client-side pagers, Load-more, infinite scroll. Custom `selector` supported.
- **Termination**: no next control, max pages/rows/time, repeated page (`no_new_rows`), no-effect click, off-site link, blocked host, kill switch, cancelled, tab closed.
- **Politeness/safety**: >=500 ms delay + jitter, robots.txt (warn / `respectRobots`), destructive-label deny-list, own background tab, audit entry per page (host only).
- **Tests**: +19 unit (pagination heuristics, robots parser, wait helpers) and +16 E2E crawl tests (every pagination style, dedupe, caps, robots, deny-list, BUSY, cancel-with-partial-save, inPlace, kill switch, audit, **worker kill mid-crawl -> 25/25 rows, no gaps or duplicates**). Totals: 61 unit + 43 E2E, stable over two consecutive full runs.
- **Bugs found by the tests and fixed**: (1) extension could stay attached to the previous port's hub when the port setting changed mid-connect (also meant test runs could grab a developer's real hub on 8765; tests now use a private port via a patched copy of the extension); (2) `resume()` raced with the alarm and launched two loops for one job, corrupting chunk counters and losing rows; (3) injection collided with in-flight navigations (`Frame with ID 0 was removed`), now retried; (4) a stale "complete" tab event could end a navigation wait early.

Known limits: one crawl at a time; a click-driven pager killed exactly between the click and its bookkeeping can skip a page on resume (link/template pagination cannot); the redundant re-extraction after a resume counts toward `maxPages`; no per-domain concurrency (single tab by design); no HTTP-status visibility (429 backoff would need `webRequest`/`webNavigation` permissions, not requested); detail-page following ("follow link -> extract fields") is not built yet.

### 11.3 Detail-page following shipped (2026-09-21)

- `crawl_start {detail}`: each new list row's link is visited in a second background tab; fields appended (JSON-LD/meta/text auto mode, or explicit selectors with `join`/`attr`), plus `detail_status`. Same-site only, blocklist enforced, per-visit politeness delay, `maxDetails`, three-strikes stop (`detail_errors`).
- Resume: rows are flushed in batches of 5 and de-duplicated on the *list* columns, so a killed worker re-fetches only unsaved rows (E2E: 10/10 rows, in order, every detail page fetched, at most 6 repeats).
- Tests: +21 unit (JSON-LD variants, auto fallbacks, fields/join/attr, helpers, ordering) and +11 E2E (auto + exactly-once visits + tabs closed, fields/collision renames, off-site and empty links never fetched, failure streak, cap, config errors, explicit link field, kill switch with no wasted visit, worker kill mid-detail). Totals: 75 unit + 54 E2E, stable over two full runs.
- Bugs found by the tests and fixed:
  1. **Object key order is lost across Chrome extension APIs** (`executeScript` args, `chrome.storage`, messaging turn objects into sorted maps). Column *names* were in the requested order but *cells* came back alphabetical, so values were labelled with the wrong names (silent data corruption). Field specs now travel as ordered `[name, spec]` pairs, normalised once at the boundary; this also fixed `mode: fields` (list crawls and `page_extract`), which had been silently alphabetised.
  2. **A resumed crawl counted the re-read of an already-stored page as a page**, so a small `maxPages` ended the crawl half done. Pages now count on completion, and a redundant re-read counts for nothing.
  3. `crawl_status` showed counters only as of the last storage write; running jobs now report live counters.

Known limits: detail pages are fetched one at a time in one tab (no concurrency, by design); HTTP status codes are not visible (a 404 page shows as `empty`/`ok` depending on what it contains); detail fields are single-page (no following links from a detail page); auto mode covers common schema.org types only (Product, Article-like), otherwise it falls back to h1/meta/text.

### 11.4 Feature-parity push (2026-09-22)

The user pasted a competing commercial extension's marketing page (a no-code, point-and-click,
human-facing scraper with a cloud platform) and asked to "add all of these features" and write a
README for other people. Mapped their 7 tools onto MCP tools that fit this project's actual model
(Claude/agent-driven via MCP, local-first, no cloud) rather than cloning their UI or infrastructure:

| Their feature | What was built | Where |
|---|---|---|
| List Extractor | already had it (M3 `crawl_start`) | `extension/src/bg/crawler.ts` |
| Page Extractor | `extract_urls` — one row per URL from an explicit list, same JSON-LD/meta auto extraction as crawl `detail` | `extension/src/bg/batch.ts`, `mcp-server/src/server.ts` |
| Email Extractor + Social Link Extractor | merged into one tool, `find_contacts` (single-page instant, or multi-page via `urls`/`discoverFrom`) | `extension/src/core/contacts.ts` |
| Image Downloader | `find_images` (list, or `download: true` to fetch bytes to disk) | `extension/src/core/contacts.ts` (listing), `mcp-server/src/download.ts` (fetch+save) |
| Sitemap Explorer | `sitemap_explore` — pure Node fetch of sitemap.xml/robots.txt, no browser tab | `mcp-server/src/sitemap.ts` |
| Shopify Extractor | `shopify_catalog` — pure Node fetch of `/products.json`, one row per variant | `mcp-server/src/shopify.ts` |
| Page Text Extractor | already had it (`page_text`); no separate bulk tool added (extract_urls covers the bulk case via fields/auto) | — |
| Recipes (save & rerun) | `recipe_save` / `recipe_run` / `recipe_list` / `recipe_delete` — JSON files under `~/.scrapeline/recipes`; `tool()` registers every tool into a `runnable` map so `recipe_run` calls it in-process | `mcp-server/src/recipes.ts`, `server.ts` |
| Data Table / spreadsheet UI, Google Sheets export | **not built** — contradicts local-first/no-cloud thesis; files only (csv/json/ndjson) | — |
| Cloud Platform (scheduled runs while the laptop is off) | **not built** — fundamentally can't work locally (needs the browser open); documented as an explicit non-goal | README "How this compares" |
| Side-panel click-to-select UI | **not built** — Claude generates selectors itself; a human picker isn't this tool's job | README "How this compares" |

New shared engine: `extension/src/bg/batch.ts` — a second persisted-job engine (paralleling
`crawler.ts`) for "visit a queue of URLs, one row per page" instead of pagination: powers
`extract_urls`, `find_contacts`, `find_images` in their multi-page forms. Supports an explicit
`urls` list or `discover: {url, maxPages}` (BFS same-site link following via a new
`extension/src/core/links.ts`).

Tests: +8 unit files (contacts, download, sitemap, shopify, recipes) totaling 112 unit tests, +1
E2E spec (`newtools.spec.ts`, 12 tests) exercising every new tool against fixture routes added to
`tests/e2e/site.ts`. Full suite: 112 unit + 66 E2E, stable over two consecutive full runs.

Bugs found by the tests and fixed:
1. **`waitSec` silently dropped** in `extract_urls`/`find_contacts`/`find_images`'s calls into
   `batch_start` (destructured out or omitted from the forwarded params), so those tools always
   waited the internal 20s default regardless of what was asked. Fixed by forwarding the whole
   args object (matching the working `crawl_start` pattern) or explicitly including `waitSec`.
2. **Wrong stop reason for the common case**: `batch.ts` checked `visited >= maxPages` before
   `cursor >= queue.length`, so a plain `extract_urls` call (where `maxPages` defaults to the URL
   count) always reported `max_pages` instead of the more accurate `done`. Reordered the checks.
3. Two of my own test regexes were wrong, not the code (Shopify pagination stops one request
   earlier than my test assumed; a fields-mode item with only a fallback `<h1>` is legitimately
   `ok`, not `empty`).

Also fixed mid-session: the local `.browsers/chrome-win64/chrome.exe` copy (the earlier workaround
for Playwright's bundled Chromium failing SxS activation) started being blocked by a Windows
Application Control policy ("An Application Control policy has blocked this file") partway through
this session — a machine/environment change, not caused by this project. Switched the E2E harness
to launch installed Edge (`channel: 'msedge'`) by default, since it's signed and already
confirmed working (the user loaded the real extension into Edge this session); overridable via
`SCRAPELINE_BROWSER_CHANNEL` / `SCRAPELINE_CHROMIUM`. See also the memory note on this.

Known limits carried over from this batch: contact/phone-number detection is a best-effort regex
(no perfect way to distinguish a phone number from a dash-separated ID or date; ISO dates are
explicitly excluded but other false positives are possible); `find_images` download and
`shopify_catalog`/`sitemap_explore` run in the MCP server process via plain `fetch`, not through
the user's browser session (by design — these are public, unauthenticated resources); batch jobs
don't support per-domain concurrency (one tab, one job at a time, same as crawl).

### 11.5 Bug fix, popup redesign, and project site (2026-09-22)

User asked to "find error and fix it, make ui better and clean, and also want website for it,
other feature to connect and give mcp to connect to other ai models."

- **Real bug found and fixed**: the popup polled `chrome.storage.local` every 2s and rewrote the
  port/token/block-list inputs from the stored values unconditionally — so typing into any of
  those fields for more than ~2s got silently overwritten mid-edit. Fixed by switching from
  polling to a `browser.storage.onChanged` listener (only re-renders fields the user isn't
  currently focused in) — polling is now used only for the connection-status dot, which has no
  text input to clobber. New regression test (`tests/e2e/popup.spec.ts`) types into a field,
  triggers a background storage write mid-edit, and asserts the typed text survives; 3 more popup
  tests cover save round-trip, live audit-log updates, and the kill switch. Full suite: 112 unit +
  70 E2E, stable over a run.
- **Popup redesign**: `extension/src/entrypoints/popup/{index.html,main.ts}` rebuilt — light/dark
  theme tokens, a real toggle switch for the kill switch, a collapsible settings section (`<details>`),
  a save confirmation flash, and a cleaner activity log. Visually verified via Playwright screenshots
  (open + collapsed states) before considering it done.
- **Project website**: `site/index.html`, published as an Artifact
  (https://claude.ai/artifact/P6NmytcJgMchpNR5n1xNf1) — a single-page site (hero, architecture
  diagram, tool catalogue, "connect other AI clients" cards for Claude Code/Desktop/Cursor-Windsurf/
  claude.ai-web, safety model, quickstart). No fabricated stats, reviews, or store presence (unlike
  the competitor page that prompted the earlier feature-parity push) — everything on it is true of
  this repo today. Verified rendering at desktop and mobile widths before publishing.
- **"Connect to other AI models"**: this was already inherently true (MCP is an open protocol; any
  MCP-compatible client can already use the same local server) — the ask here was really *making
  that discoverable*, so it's now documented in both the README ("Connecting other AI tools") and
  the website's "Connect" section: Claude Code/Desktop, Cursor/Windsurf/other MCP editors (same
  stdio command), and an explicit explanation of why claude.ai-the-website can't reach a local
  stdio server without a tunnel + real auth first (not yet built).
