---
name: lagoslife-guide
description: Use when updating, enriching, or adding pages/data to the Lagos Life guide website (lagoslife.homes) — researching the game from the reference sites, editing the single-file site and build script, rebuilding, and deploying via git push to Cloudflare Pages. Trigger on requests like "丰富/更新网站", "add a guide page", "update the data", "lagoslife 攻略".
---

# Lagos Life Guide — site upkeep skill

Everything needed to extend and refresh the unofficial Lagos Life guide at
**https://lagoslife.homes**. Read this before touching the site.

## 1. What the site is
- A static, **pre-rendered** guide to the browser game *Lagos Life*, in a **dark,
  data-tool** style (near-black `#09090b`, card `#18181b`, orange `#ea580c`,
  Bricolage Grotesque headings + system sans body, radius 10px).
- Independent / unofficial. Ads: **AdSense** (primary, `ca-pub-7013767592975009`)
  + **Adsterra** (banners, backfill). Two ad slots per page (top + bottom).

## 2. Repo, files, and architecture
Project root: `E:\开发\seo\lagoslife` · Repo: `github.com/hilyca6/seo-lagos` · Host: Cloudflare Pages (project `lagoslife-homes`).

| File | Role |
|---|---|
| `index.html` | The whole site: template + inline `<style>` (theme) + one inline `<script>` (content + router) |
| `build.js` | Pre-renders every route into `dist/` (reads index.html, runs the inline script in a `vm` sandbox, gets `module.exports`) |
| `package.json` | `"build": "node build.js"` |
| `sitemap.xml`, `robots.txt`, `ads.txt`, `_headers` | SEO / ads / headers (copied into dist by build.js) |
| `favicon.svg`, `favicon.ico`, `og-image.png`, `screenshot.png` | assets (copied into dist) |
| `ads/banner-desktop.html`, `ads/banner-mobile.html`, `ads/native.html` | Adsterra iframe templates |
| `.nvmrc` (20) | Node version for Cloudflare |
| `draft-*.html`, `*.txt`, `*.png` (except allowed) | ignored; `PLAYBOOK.md` is gitignored but kept locally |

**Key JS structures inside `index.html`:**
- `PAGES` = `route → { title, desc?, after?, render() }`. `render()` returns the page HTML string.
- `article({ crumb|crumbs, kicker, title, body, faq, related, sources, noAds })` — the standard inner-page shell (breadcrumbs + article card + prose + visible FAQ + Related guides).
- `DESCS` = `route → meta description`. `FAQ` = `route → [{q,a}]` (drives BOTH visible FAQ and `FAQPage` JSON-LD — **keep them in sync**).
- `ITEMS_LD` = `route → [{t,r}]` for `ItemList` JSON-LD (used by /guides, /compare).
- Data tables: `CAREERS`, `ACTIVITIES`, `ITEMS`, `VENUES`, `HOMES`, `BUSINESSES`, `LAND`, `GIGS`, `TRAITS`, `SKILLS`, `NEEDS`, `SUPPORT`, `TIPS`, `TIMELINE`, `UPDATES`, `STATS`.
- Helpers: `nai(n)` (₦ + commas), `dt(head, rows)` (dark data table), `faqSection(list)`, `careerTable()`, `activityTable()`, `bindJobs()`, `bindActivities()`, `ldGraph(route,page,desc)` (JSON-LD), `slugify()`.
- **Venue pages are generated**: `VENUE_PAGE_NAMES.forEach(...)` builds `/locations/<slug>` pages from `VENUES` + `ACTIVITIES`, and sets `FAQ[route]`/`DESCS[route]`.
- Router: History API (path routing), intercepts internal `<a>`, updates `title`/canonical/OG/JSON-LD per route, runs `page.after`, `initAds()`, cookie bar.

## 3. Reference sources (where the data comes from)
Research these, then **rewrite in our own words** (never paste verbatim):

- **Official (facts/source of truth for names, links, dates):** `https://lagoslife.app` (+ `/stats`, `/terms`, `/privacy`). CSR app — only metadata/JSON-LD are readable. Official contact `support@lagoslife.app`; official socials: X `@LagosLifeApp`, IG `@lagoslifeapp`, TikTok `@official.lagos.lif`, LinkedIn `lagos-life-app`; developer X `@Shalom_HeyEliy`.
- **`https://lagoslife.org`** — independent player guide (also our visual design origin). Pages: what-is, how-to-play, game-link, locations, updates, account, age-requirement, top-up, safety-and-privacy, nepo-vs-lapo, jobs, danfo, nepa, lagos-slang, locations/quilox, shalom-rayhamen, vs-sims, governor-election, sea-plots, houses, money, download, unblocked.
- **`https://lagoslifeguide.com`** — wiki-style, **richest numbers**: 21 careers × 5 = 105 levels, all businesses/land, 30+ places with 260+ activities & hours.
- **`https://lagoslife.wiki`** — second wiki: homes/rent tiers, skills/traits, items/prices, venues, tips, "not working".
- **`https://toptrending.games/games/lagos-life/`** — stats, timeline, quick tips.

**Conflict rule:** sources disagree (e.g. 21 vs 14 careers, ₦99k vs ₦66k top pay, ₦60k vs ₦72k LAPO loan, 30 vs 31 places). **Use the highest figure** and say it's "reported". Present ranges when useful (we did on /stats).

## 4. Update workflow (the loop)
1. **Research** the topic on the sources above (webfetch). For many pages at once, spawn a `general` subagent to fetch and return compact outlines.
2. **Verify** against the official site when possible; mark unverified items as "reported".
3. **Edit `index.html`**: add/enrich `body` (original prose), add a matching visible `FAQ[...]` entry, add `faq: FAQ["/route"]` to the page, and a `DESCS[...]` entry.
4. **New page?** add `PAGES["/route"]`, `FAQ`, `DESCS`, a footer link, and a `<url>` in `sitemap.xml`.
5. **Build** locally: `node build.js` (targets `dist/`).
6. **Verify locally**: `node --check` the inline script; grep `dist/<route>.html` for the new content.
7. **Commit + push** (see §7). Cloudflare auto-builds `dist/` → live.
8. **Verify live** (curl/webfetch) and, if it's a new URL, add it to `index-urls.txt` for GSC indexing.

## 5. Content conventions & gotchas
- **Never copy** the reference sites' text/images/logos verbatim (copyright). Rewrite facts in our own words; use original SVG art; text wordmark only.
- **FAQ must match**: whatever is in `FAQ[route]` is rendered visibly AND emitted as `FAQPage`. Don't put a route in `FAQ` if the page doesn't render it (compliance pages use `noAds` and no FAQ).
- **JSON-LD**: `ldGraph()` auto-adds `Organization` + `Article` + `BreadcrumbList` (+ `FAQPage` if `FAQ[route]`, + `ItemList` if `ITEMS_LD[route]`). Pages already carry `canonical`/OG.
- **Inner pages keep the lagoslife.org-style completeness**; only the **homepage** uses the custom data-portal layout (hero with screenshot, "What is Lagos Life?" first, quick actions, stats, careers board, directory tiles, FAQ).
- **Dark theme tokens** live in `:root` (`--bg --fg --card --muted --muted-fg --border --primary --r-lg …`). Use them; never write light-mode colors.
- **Ads**: two fixed slots (top after header, bottom after `</main>`) via `ads/banner-*.html` iframes; `initAds()` swaps desktop/mobile by width. Policy pages aren't special-cased anymore (ads are global). Don't stack more ads.
- **Escapes**: HTML attributes inside JS strings use **single quotes**; the body strings are double-quoted. Em dash = `\u2014`, ₦ = `\u20a6`, quotes = `\u201c/\u201d`.
- **`.gitignore` trap**: `/*.txt` and `/*.png` are ignored except `robots.txt`, `ads.txt`, `og-image.png`, `screenshot.png`. If you add a new root `.txt`/`.png` asset, add a `!/name` exception or it won't deploy.

## 6. Build & preview
```bash
npm run build            # = node build.js  -> writes dist/
# local preview of path routing + 404 (optional small static server serving dist)
```

## 7. Git / deploy (network is flaky; retry)
GitHub is reached through a local proxy that comes and goes. Push with a retry loop over proxy then direct:
```powershell
$env:GIT_TERMINAL_PROMPT=0
git add -A; git commit -m "message"
$ok=$false; for($i=1;$i -le 8 -and -not $ok;$i++){ foreach($mode in @('proxy','direct')){
  if($mode -eq 'proxy'){ git -c http.proxy=http://127.0.0.1:7897 push origin main 2>&1 | Out-Null }
  else { git -c http.proxy= push origin main 2>&1 | Out-Null }
  if($LASTEXITCODE -eq 0){ $ok=$true; "pushed via $mode"; break } else { Start-Sleep 3 } } }
```
Cloudflare builds on push to `main` (build `npm run build`, output `dist`). Wait ~60–90s, then verify live.

## 8. SEO checklist for any change
- [ ] Page has `title` (keeps the keyword "Lagos Life") and a `DESCS` entry.
- [ ] Visible FAQ == `FAQ[route]` (drives `FAQPage`).
- [ ] New route added to `sitemap.xml`; new `.txt`/`.png` assets un-ignored.
- [ ] Internal links added (Related guides, cross-links, footer/nav if important).
- [ ] `node --check` clean; `node build.js` succeeds; live 200.

## 9. Monetization quick facts
- AdSense publisher id `ca-pub-7013767592975009`; loader script + `google-adsense-account` meta are in `<head>`; `ads.txt` line = `google.com, pub-7013767592975009, DIRECT, f08c47fec0942fa0`.
- To show AdSense ads: enable **Auto ads** (no extra code) or paste manual `<ins class="adsbygoogle">` unit code into an ad slot.
- **AdSense review / policy**: prefer AdSense primary; keep total ads ≤2–3 per page; avoid Adsterra popunder/social-bar; don't click own ads. Adsterra impressions vs AdSense RPM are both low for Nigeria-heavy traffic — **traffic is the lever**.

## 10. Reference docs kept locally (not deployed)
- `PLAYBOOK.md` — full build-and-launch playbook (Cloudflare, DNS, GSC, ads).
- `index-urls.txt` — copyable list of URLs to request indexing in Google Search Console.
- `draft-home.html`, `draft-home2.html`, `draft-sitehunter.html` — layout drafts.
