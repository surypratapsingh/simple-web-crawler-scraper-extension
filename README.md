# Scrapeline — a web scraper built for Claude, not for clicking

Scrapeline is a browser extension plus a local MCP server. Together they let **Claude** (Claude
Code, Claude Desktop, or any other MCP client) read and scrape the pages **you already have open**
— logged-in sessions included — and crawl, extract, and export data on request, entirely on your
own machine. There's no cloud service, no account, and nothing leaves your computer unless you
export it yourself.

If you've used a no-code scraper extension before (click one item, get a spreadsheet), the
difference here is *who's driving*: instead of you pointing and clicking, you tell Claude what you
want in plain English, and Claude calls the same kind of extraction engine through MCP tools. See
[§ How this compares to a click-to-scrape extension](#how-this-compares-to-a-click-to-scrape-extension)
if that's what you're picturing.

See [USE_CASES.md](USE_CASES.md) for 340 concrete things people use it for, and
[PLAN.md](PLAN.md) for the full product plan, architecture rationale, and build history.

```
Claude ──stdio──▶ MCP server ──ws://127.0.0.1:8765──▶ extension (service worker) ──▶ your tab
```

## Quickstart

Requires Node 20+ (developed on Node 24).

```bash
git clone https://github.com/surypratapsingh/simple-web-crawler-scraper-extension.git
cd simple-web-crawler-scraper-extension
npm install
npm run build          # builds mcp-server/dist and extension/.output/chrome-mv3
```

1. **Load the extension.** Open `chrome://extensions` (works the same in Edge, at
   `edge://extensions`; Brave too), turn on **Developer mode**, click **Load unpacked**, and pick
   `extension/.output/chrome-mv3`.
2. **Register the MCP server.**
   - **Claude Code**: this repo ships a project-scoped [`.mcp.json`](.mcp.json) — run `claude` from
     this folder and approve it when prompted. From anywhere else:
     ```bash
     claude mcp add scrapeline -- node /path/to/simple-web-crawler-scraper-extension/mcp-server/dist/server.mjs
     ```
   - **Claude Desktop**: add to `claude_desktop_config.json`:
     ```json
     { "mcpServers": { "scrapeline": {
         "command": "node",
         "args": ["/path/to/simple-web-crawler-scraper-extension/mcp-server/dist/server.mjs"] } } }
     ```
3. Click the extension's toolbar icon — the status dot turns green once it's connected to the MCP
   server.
4. Ask Claude something like *"list my open tabs"*, *"scrape the product grid on this page to
   CSV"*, or *"crawl this listing across all its pages and save it"*.

Several Claude sessions can share one browser: the first MCP process becomes the hub, later ones
relay through it automatically.

After pulling changes or running `npm run build` again, **reload the extension** in
`chrome://extensions` and **restart your Claude session**, so both sides pick up the new build.

There's also a one-page project site with the same information laid out visually:
[`site/index.html`](site/index.html) (open it in a browser).

## Connecting other AI tools (MCP is an open protocol)

Scrapeline isn't Claude-exclusive — it's a normal local MCP server over stdio, so anything that
speaks MCP can use it the same way:

- **Claude Code / Claude Desktop** — see Quickstart above.
- **Cursor, Windsurf, or any other MCP-capable editor/agent** — point its MCP config at the same
  built server: `{ "command": "node", "args": ["/path/to/simple-web-crawler-scraper-extension/mcp-server/dist/server.mjs"] }`.
  Multiple clients can share one running browser at once (hub/relay, as above).
- **claude.ai in the browser** — this is the one exception: the web app runs entirely in
  Anthropic's cloud and has no path to a `stdio` process on your machine, so it can never see a
  local server no matter how it's configured there. The only way around that is putting a public
  URL in front of the local server (e.g. via ngrok or a Cloudflare Tunnel) and adding real
  authentication first — Scrapeline currently trusts whatever calls it and reads your live,
  logged-in tabs, so don't expose it publicly without that.

## What it can do

Everything below is exposed as an MCP tool Claude calls directly — there's no UI to learn, you
just describe what you want. Costs are approximate token counts for a typical page.

### Look around (cheap, escalate as needed)

| Tool | What it does | Typical cost |
|---|---|---|
| `browser_status` | Is the extension connected? | ~20 tok |
| `list_tabs` | id / title / url of every open tab | ~10 tok/tab |
| `page_info` | title, h1, description, element counts | ~60 tok |
| `page_outline` | headings, forms, tables/lists, buttons, top links (+ refs) | 300–600 tok |
| `page_text` | readable main text, boilerplate stripped, `offset` to page through it | you set the budget |
| `page_query` | text/attributes for a CSS selector or a ref from `page_outline` | small |
| `page_scroll` | scroll (triggers lazy-loading / infinite scroll) | tiny |
| `open_url` | open a URL in a new **background** tab | tiny |

All page-derived text is prefixed with an "untrusted content" marker, so text embedded in a page
is treated as data by Claude, never as instructions.

**Iframes and shadow DOM** are handled transparently: open shadow roots are read like normal DOM,
and `page_outline` lists real cross-origin sub-frames you can target with `frameId` on any of the
tools above.

### Extract structured data from one page

`page_extract` finds the main table or repeating list on a page automatically (product grids,
search results, feeds) — or, given a `rowSelector` and per-field selectors, extracts exactly what
you specify. Either way, output is TSV (cheap) or JSON. Add `saveAs: "csv" | "json" | "ndjson"`
and it writes **every** row to a file under `~/.scrapeline/exports` and hands Claude back just the
path and a 3-row preview, so a 5,000-row table costs about as many tokens as a 5-row one.

### Crawl a whole listing across pages

`crawl_start` follows pagination — "Next" links/buttons, a `{n}` URL template, or infinite scroll
— collecting de-duplicated rows into its own background tab (your tabs are left alone unless you
ask for `inPlace`). It's a background job: it waits briefly for completion, then hands back a job
id to poll with `crawl_status`. State is saved after every page, so **a crawl survives the browser
extension being reloaded or restarted** and picks up where it left off.

It's polite and safe by construction: at least 500ms between pages (with jitter), hard caps on
pages/rows/time, a check of `robots.txt` (warns by default; `respectRobots: true` refuses outright
if disallowed), and it will only ever click a control that looks like pagination — never a
form-submit button, and never anything labelled like "delete", "buy", "sign out" etc., even if you
hand it that selector directly.

```
crawl_start { url: "https://example.com/listing", maxPages: 20, saveAs: "csv" }
```

Add `detail: {}` and it will also open each **new** row's link (same site only) in a second
background tab and append fields from that page — either automatically (JSON-LD/meta: price, SKU,
availability, description...) or via your own selectors. Every row gets a `detail_status` so you
can see what worked.

### Bulk-extract a list of URLs ("Page Extractor")

Already have the URLs — a list of product pages, profiles, or articles? `extract_urls` visits each
one (same background-job machinery as crawling) and returns one row per page, again either
automatically from JSON-LD/meta or via your own field selectors.

```
extract_urls { urls: ["https://shop.example.com/p/1", ".../p/2", ...], saveAs: "json" }
```

### Find contact info and social links

`find_contacts` scans a page (or, with `urls` / `discoverFrom`, many pages) for email addresses,
phone numbers, and social profile links (X, Instagram, Facebook, LinkedIn, YouTube, TikTok,
GitHub, Reddit, and more) — filtering out the platforms' own generic pages (share buttons, login
screens) so you get real profiles. `discoverFrom` follows same-site links to find a Contact/About
page on its own.

```
find_contacts { discoverFrom: { url: "https://example.com", maxPages: 10 } }
```

### List or download every image on a page

`find_images` lists image URLs on a page (or across many, like `find_contacts`) with size
filtering so icons and tracking pixels are skipped automatically. Add `download: true` and it
fetches the actual files to `~/.scrapeline/downloads/<folder>` instead of just listing URLs.

### Map a whole site from its sitemap

`sitemap_explore` reads a site's `sitemap.xml` (following a sitemap index, and checking
`robots.txt` for a `Sitemap:` line if you just give it a bare domain) and returns the URLs it
lists — instantly, with no browser tab involved, since sitemaps are public by design. Feed the
result straight into `extract_urls` or `crawl_start`.

### Export a Shopify store's whole catalogue

`shopify_catalog` reads any live Shopify store's public `/products.json` endpoint and flattens it
to one row per variant (product, variant, SKU, price, compare-at price, availability, vendor,
type, tags, image, URL) — again instant and tab-free.

### Save a setup and run it again

`recipe_save` stores the arguments of any call above under a name; `recipe_run` replays it later
(optionally overriding some arguments), and `recipe_list` / `recipe_delete` manage what's saved.
Recipes are plain JSON files under `~/.scrapeline/recipes`, so they're easy to inspect, back up, or
hand to a colleague running the same setup.

```
recipe_save { name: "weekly competitor scan", tool: "crawl_start", args: { url: "...", saveAs: "csv" } }
recipe_run  { name: "weekly competitor scan" }
```

## Safety model

- The bridge binds `127.0.0.1` only, and rejects any WebSocket connection that isn't from a
  `chrome-extension://` origin — a malicious web page cannot talk to it. An optional shared token
  (`SCRAPELINE_TOKEN`) and pinned extension id (`SCRAPELINE_EXTENSION_ID`) add defense in depth.
- The popup has a **kill switch** (Claude access on/off), a per-host **block list**, and an
  **audit log** of every call (method + host only — page content is never logged).
- Only `http(s)` pages are readable; the Chrome/Edge Web Store and browser-internal pages are
  refused. There is no general click/type/fill capability — the only clicks anywhere in the system
  are the crawler's own pagination controls, which are restricted to things that look like
  pagination and never anything destructive-sounding.
- Filenames for exports, downloads, and recipes are sanitized (no directories, no traversal) and
  files are never overwritten silently.
- The development build requests `<all_urls>` so it works everywhere out of the box; a Chrome Web
  Store submission would instead use `activeTab` + optional host permissions.

Env vars for the MCP server: `SCRAPELINE_PORT` (default 8765), `SCRAPELINE_TOKEN`,
`SCRAPELINE_EXTENSION_ID`, `SCRAPELINE_EXPORT_DIR`, `SCRAPELINE_DOWNLOADS_DIR`,
`SCRAPELINE_RECIPES_DIR`. Change the port in the popup to match if you set one.

## How this compares to a click-to-scrape extension

Point-and-click scraper extensions (highlight one item, get a spreadsheet) are built for a human
sitting at the browser deciding what to click. Scrapeline is built for the case where an AI agent
is doing the work on your behalf: you describe the goal, Claude picks the right tool (or chains
several — outline, then extract, then crawl, then save), and it can act on many pages
unattended within the guardrails above. That trade-off means:

- **No visual point-and-click picker.** Claude generates and refines CSS selectors itself from the
  page structure; you never draw a box around an element. (A human-facing picker is a plausible
  future addition, but isn't the point of this tool today.)
- **No hosted "run it while your laptop is off" cloud tier.** Everything runs locally, by design —
  see the non-goals in [PLAN.md](PLAN.md). A crawl only runs while your browser and this MCP
  server are both up.
- **No spreadsheet UI.** Results go to CSV/JSON/NDJSON files (or straight into Claude's answer);
  open them in whatever you already use.
- **No Google Sheets / cloud export integration yet** — plain files only, for now.

## Development

```bash
npm test               # unit tests (Vitest + jsdom): extraction/crawl/contacts/sitemap/shopify/... logic
npm run test:e2e       # Playwright: a real browser + the built extension + a real MCP client over stdio
npm run typecheck
cd extension && npx wxt  # dev mode with HMR
```

The E2E suite launches installed Edge by default (`channel: 'msedge'` in `tests/e2e/harness.ts`) —
Playwright's own bundled Chromium can get blocked by some Windows Application Control / antivirus
policies when copied into a temp folder, which installed, signed browsers aren't subject to. Set
`SCRAPELINE_BROWSER_CHANNEL=chromium` (or `chrome`) or `SCRAPELINE_CHROMIUM=/path/to/exe` to
override.

## License

[MIT](LICENSE).
