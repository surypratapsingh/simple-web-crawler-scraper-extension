# Decision Log
Format per entry:
## YYYY-MM-DD - Decision title
- Decision:
- Context:
- Alternatives rejected:
- Consequences:

More detailed reasoning is in PLAN.md §3 (platform facts), §6 (architecture) and §10 (risks).

## 2026-09-21 - Claude drives via MCP instead of a click-to-scrape UI
- Decision: A browser extension plus a local MCP server (stdio → ws://127.0.0.1:8765 → extension). Claude generates the selectors.
- Context: The goal is cheap "eyes" for Claude on pages the user already has open, including logged-in pages.
- Alternatives rejected: A human-facing point-and-click picker as the primary UI (deferred, then dropped).
- Consequences: Several Claude sessions share one browser through a hub/relay; scraped content is labelled as untrusted.

## 2026-09-21 - WXT framework for the MV3 extension
- Decision: Build the extension with WXT.
- Context: WXT is Vite-based, builds for several browsers and is actively maintained.
- Alternatives rejected: Plasmo (core last released May 2025, still alpha).
- Consequences: One codebase for Chrome/Edge now and Firefox later.

## 2026-09-21 - Persist all job state and make crawls resumable
- Decision: Crawl and batch jobs are stored in `chrome.storage.local` and resume after the service worker is killed.
- Context: MV3 service workers terminate after 30 s idle.
- Alternatives rejected: Keeping job state in memory.
- Consequences: A worker kill mid-crawl still gives 25/25 rows with no gaps.

## 2026-09-21 - Local-first, no cloud, no stealth
- Decision: No cloud platform, accounts or telemetry. No CAPTCHA solving, fingerprint spoofing or proxy rotation. Polite defaults (≥500 ms delay, robots.txt warnings).
- Context: Chrome Web Store policy, and user trust.
- Alternatives rejected: Cloud-scheduled runs, Google Sheets export (§11.4).
- Consequences: Exports are files only (csv/json/ndjson); scheduling needs the browser to be open.

## 2026-10-06 - Public GitHub repo under the MIT licence
- Decision: Publish as `surypratapsingh/simple-web-crawler-scraper-extension` under the MIT licence. Product name stays "Scrapeline" in the code and docs.
- Context: The user asked for a public repo with that name. The user picked no licence, so MIT was chosen as the permissive default.
- Alternatives rejected: Apache-2.0 or GPL (no reason given to need either), renaming the product to match the repo.
- Consequences: Anyone can reuse the code. To change the licence, edit LICENSE and package.json.

## 2026-09-22 - E2E runs on installed Edge
- Decision: The Playwright harness uses `channel: 'msedge'` by default (override with SCRAPELINE_BROWSER_CHANNEL / SCRAPELINE_CHROMIUM).
- Context: A Windows Application Control policy started blocking the copied `.browsers/chrome-win64` Chromium.
- Alternatives rejected: Playwright's bundled Chromium (fails SxS activation here).
- Consequences: E2E depends on Edge being installed.
