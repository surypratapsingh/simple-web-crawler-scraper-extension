# Progress Log
Newest entry first. Each entry: Done / In progress / Next / Blockers.

> `PLAN.md` is this project's plan file. On Windows, `plan.md` and `PLAN.md` are the same file. Its §11 has the detailed build history.

## 2026-10-06 - Published to GitHub
- Done: added MIT LICENSE, package.json metadata (description, license, repository, engines), .gitignore entries for .env and *.bak. README and site now use the real clone URL, and the private artifact link is replaced with `site/index.html`. Typecheck, 112 unit tests and build pass. `git init`, first commit, pushed to the public repo https://github.com/surypratapsingh/simple-web-crawler-scraper-extension.
- Next: CI workflow (typecheck + unit) if wanted. The user still has to reload the Edge extension (bulk tools show `unknown method batch_*`) and add `mcpServers` to the Claude desktop config while the app is closed.

## 2026-09-24 - Full test run, live check, USE_CASES.md
- Done: typecheck, 112 unit and 70 E2E tests all pass. Live in the user's Edge, browser_status, list_tabs, page_info, page_outline, sitemap_explore and recipe_list work. Wrote USE_CASES.md (340 use cases in 25 groups, 12 patterns × 40 site types, limits, responsible use) and linked it from the README.
- Blocker (user action): the Edge extension is an old build, so find_contacts gives `unknown method batch_start`. Reload it at edge://extensions and restart the Claude session.
- Next: after the reload, test extract_urls, find_contacts, find_images and crawl_start live. Then `git init`.

## 2026-09-24 - Project memory files added
- Done: progress.md and decisions.md written from PLAN.md and the README. PLAN.md was left unchanged.
- State (per PLAN.md §11.5, 2026-09-22): 112 unit + 70 E2E tests. Extension and MCP server are built. Tools: tabs/page read, extract, crawl, extract_urls, find_contacts, find_images, sitemap_explore, shopify_catalog, recipes.
- Next (from PLAN.md's open items):
  1. Run it for real against the user's Chrome/Edge and a real Claude Code session. So far it has only been tested with a scripted MCP client.
  2. Remove the ~27 s reconnect delay after the service worker is killed (native messaging).
  3. Store build: switch `<all_urls>` to `activeTab` plus optional host permissions (M6).
  4. M4 AI: describe-to-schema and self-healing selectors.
- Blockers: not a git repo yet, so run `git init` before more work. E2E runs on installed Edge because a Windows Application Control policy blocks the copied Chromium.

## 2026-09-22 - Feature-parity push, popup fix + redesign, project site
- Done: see PLAN.md §11.4–11.5.

## 2026-09-21 - M0, M1, M2-lite, M3, detail-page following
- Done: see PLAN.md §11–11.3.
