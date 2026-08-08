# FEATURE: Puppeteer RemoteOK Crawl Strategy (Increment 4)

## Overview

Adds the second real `CrawlStrategy` to the crawler: `remoteok`, which per `CLAUDE.md`'s Data
Sources table is `DYNAMIC` because a plain (non-browser) request gets a Cloudflare-issued 403 —
confirmed again in this increment's spike. Puppeteer is needed not merely to execute JS, but to
present as a real browser and get past the bot wall at all.

Builds directly on the `CrawlStrategy` abstraction from `02_FEATURE_REAL_CRAWLER_REDIS_ES.md` /
`02b_FEATURE_VACANCY_DETAIL_CRAWL.md`. `crawlRunner.ts` needed **no changes** — it was already
strategy-agnostic (calls `strategy.crawl()`, upserts, then optionally `strategy.enrichDetails()`).
This confirms the abstraction from Increment 2/2.2 genuinely generalizes to a second, structurally
different source without modification.

This increment also renamed the existing habr_career strategy file
(`axiosCheerioStrategy.ts` → `habrCareerStrategy.ts`) — see "Decisions locked with the user" below.

## Status

**Implemented and manually verified** (2026-08-08). Triggered real crawls of both sources through
the actual API (`POST /sources/:id/crawl`) against the live Postgres/Redis/Elasticsearch stack:

- RemoteOK: `RUNNING` → `COMPLETED`, 50 vacancies found, indexed in Elasticsearch with clean
  plain-text `description`, deduped `skillsSummary`, `isRemote: true`.
- `habr_career`: listing crawl + `enrichDetails` both still function correctly after the rename
  and after extracting the shared `htmlToText` helper (see below) — confirmed via live log output,
  then stopped early (mid-`enrichDetails`) rather than let a full 25-vacancy/12s-delay run
  complete, since the regression check didn't need the full run.
- `WeWorkRemotely`: still correctly logs a `WARN` ("crawling not yet implemented for
  WeWorkRemotely") and completes with 0 vacancies, confirming the dispatch refactor didn't disturb
  the deferred-source path.
- Frontend: confirmed via `grep` that `apps/web` renders `skillsSummary` as an opaque string
  (`entities/vacancy/ui/vacancy-card.tsx`) with no regex/parsing assumptions about its shape — no
  frontend changes needed.

## Decisions locked with the user

- **Salary field: deferred**, not part of this increment — no ES schema change, no
  `CRAWLER_RESULTS_SCHEMA_VERSION` bump, no index rebuild. (The spike below further confirms this
  was the right call: RemoteOK's `baseSalary` JSON-LD field turned out to be non-real boilerplate
  anyway — see Spike Findings.)
- **File naming: by site, not by library.** Renamed `axiosCheerioStrategy.ts` →
  `habrCareerStrategy.ts`; new file is `remoteOkStrategy.ts`. Rationale: the old name described
  the *technology* (axios+cheerio), but the file's content (selectors, JSON-LD parsing) is 100%
  habr_career-specific, and `getStrategy()` already dispatches by `source.name` — a strategy is
  conceptually 1:1 with a *site*, not a library. This was fine with one file but would only get
  more confusing (`белиберда`) as more sources/technologies are added. New convention:
  `<siteKeyCamelCase>Strategy.ts`, matching the `Key` column in CLAUDE.md's Data Sources table.
  The fetch/parse library stays an internal implementation detail, documented in each file's top
  comment.
- **New dependency**: `puppeteer` (full package, bundles Chromium) — `puppeteer-core` wasn't worth
  the extra Chromium-management complexity for a single-source MVP demo.
- **Runs on the host, not in Docker.** The API has no `Dockerfile` today; only Postgres/Redis/ES
  run in containers. Puppeteer's bundled Chromium just needs to launch on the dev machine.
  Containerizing the API later will need extra OS-level Chromium deps in that image — flagged as a
  future concern, not resolved here.
- **User-Agent**: a realistic desktop Chrome UA string, not Puppeteer's default and not any
  bot-identifying string. `robots.txt` has a Cloudflare-managed section that explicitly blocks
  `ClaudeBot` (among other AI/SEO crawlers) for general crawling, then a separate section
  re-allows the same bots for AI-reference/training use specifically — neither category applies to
  this app (it's building a job search index, not doing AI training/reference), and presenting a
  truthful non-browser UA would defeat the entire point of using Puppeteer here.
- **Dispatch stays name-based**, not type-based (`STATIC`/`DYNAMIC`). `source.type` has no other
  consumer in the codebase besides display text; coupling dispatch to it would wrongly imply
  "every `DYNAMIC` source shares one Puppeteer strategy." `getStrategy()` is now a
  `Record<string, CrawlStrategy>` keyed by `source.name`, composing cleanly for a future third
  strategy.
- **No `enrichDetails`** — confirmed unnecessary by the spike (see below): the listing page alone
  already carries everything a detail page would.
- **Skill tags**: joined into the existing `skillsSummary` string field (comma-separated) rather
  than a new array/nested field — reuses what's already there, avoids a schema bump, consistent
  with deferring salary to keep this increment scoped to the crawl mechanics.
- **Shared `htmlToText` helper extracted** (`apps/api/src/crawler/htmlToText.ts`): both strategies
  need to flatten an HTML-bearing JSON-LD `description` field into plain text with preserved line
  breaks. This was inline/duplicated logic in `habrCareerStrategy.ts`; extracting it once
  `remoteOkStrategy.ts` needed the identical transformation avoided duplicating a real algorithm
  (not just similarly-shaped code) — confirmed behavior-identical for habr_career via manual
  re-verification after the extraction.

## Spike findings (2026-08-08, against the live site)

Before writing any parser code, launched Puppeteer against real `remoteok.com` pages to confirm or
refute assumptions — mirroring `02b`'s spike precedent, since guessing selectors blind on a harder
site than habr_career would just repeat that doc's original near-miss in reverse.

- **`robots.txt`**: `Crawl-delay: 1`, `Allow: /`, disallows only AJAX (`?action=get_jobs`),
  tracking, and spam-pattern paths — none block a normal listing crawl.
- **Plain fetch → 403 confirmed**: a non-browser request to `/remote-dev-jobs` returned HTTP 403.
  A Puppeteer navigation with the chosen desktop-Chrome UA returned 200 with real content —
  confirms the bot-check theory, not just assumes it.
- **Listing page (`/remote-dev-jobs`) already has everything**: each `tr.job` row carries its own
  `data-id`, `data-company`, `data-href`, `data-epoch` (posted timestamp) attributes, a visible
  `h2` title, a tags column, *and* its own embedded `<script type="application/ld+json">` block
  with a full schema.org `JobPosting` (`description`, `baseSalary`, `jobLocationType`,
  `jobLocation`, etc.) — no detail-page fetch needed at all. `enrichDetails` is simply omitted.
- **JSON-LD parsing is unreliable, DOM attributes aren't**: roughly 1 in 4 sampled rows had a
  malformed JSON-LD block (unescaped characters from the description leaking into the JSON) that
  threw on `JSON.parse`. `externalId`/`title`/`company`/`url`/`postedAt` all come from the row's
  `data-*` attributes and DOM text (always present, always parse), while `description` is treated
  as optional bonus enrichment from JSON-LD when it happens to parse — a parse failure just means
  `description: null` for that vacancy, not a dropped/failed row.
- **`baseSalary` and location fields are boilerplate, not real data**: sampled 50 rows across two
  different page loads — every single row had the *exact same* `baseSalary` value
  (`minValue: 80000, maxValue: 150000, currency: USD`), including on clearly non-engineering,
  low-quality listings ("Wholesale", "Page Not Found", "Open Vacancies"). `jobLocationType`
  (`"TELECOMMUTE"`) and `jobLocation` (`"Anywhere"`) were likewise identical on every row. This is
  schema.org filler RemoteOK emits for Google Jobs indexing, not a genuine per-employer figure —
  the same pattern CLAUDE.md already documents for habr_career's dropped salary field. Not stored.
  `isRemote` is instead hardcoded `true` in the strategy: that's a true statement about RemoteOK as
  a 100%-remote job board, not a guess derived from the unreliable per-row JSON-LD constant.
- **No real pagination on this endpoint**: `/remote-dev-jobs?page=2` returned the *identical* 50
  job IDs as page 1 (confirmed by direct comparison) — there's no query-string pagination here, and
  RemoteOK's actual "load more" flow goes through the `?action=get_jobs` AJAX endpoint, which
  `robots.txt` explicitly disallows. `crawl()` therefore navigates to the listing exactly once per
  run regardless of `source.maxPagesToCrawl` — documented in the strategy file rather than silently
  ignored.
- **Tags render twice per row** (desktop + mobile layout variants of the same markup) — the
  `skillsSummary` builder dedupes via `Set` before joining, otherwise it would read
  `"React, React, Node, Node, ..."`.

## Data model changes

None. `RawVacancy`, `upsertVacancy`, and the Elasticsearch mapping are all unchanged — RemoteOK's
`crawl()` returns the same shape habr_career's does, using only fields that already exist
(`description`/`isRemote`/`skillsSummary` are all optional fields already in `RawVacancy`).

## Implementation plan

1. Added `puppeteer` dependency to `apps/api/package.json`; ran `npm audit fix` afterward to clear
   two transitive high-severity advisories it pulled in (`js-yaml`, `undici`) — resolved cleanly to
   0 vulnerabilities with no breaking version bumps.
2. Renamed `apps/api/src/crawler/strategies/axiosCheerioStrategy.ts` →
   `apps/api/src/crawler/strategies/habrCareerStrategy.ts`; renamed the exported const
   `axiosCheerioStrategy` → `habrCareerStrategy`; updated its top doc comment to explain the
   by-site naming convention and point to `remoteOkStrategy.ts` as the counterpart.
3. Extracted `apps/api/src/crawler/htmlToText.ts` (shared HTML→plain-text helper, see decisions
   above) and updated `habrCareerStrategy.ts` to use it instead of its inline copy.
4. New `apps/api/src/crawler/strategies/remoteOkStrategy.ts`: `crawl()` launches one Puppeteer
   `Browser` per call (closed in a `finally`), navigates to `/remote-dev-jobs` once (see spike
   findings on why not more), parses each `tr.job` row via Cheerio (DOM attributes primary,
   per-row JSON-LD `description` as best-effort bonus), reuses `waitForSlot`/`getOrFetch` exactly
   as `habrCareerStrategy` does. No `enrichDetails`.
5. `apps/api/src/crawler/index.ts`: replaced the `IMPLEMENTED_SOURCE_NAMES` set + single `if` with
   a `Record<string, CrawlStrategy>` (`STRATEGIES_BY_SOURCE_NAME`) mapping `"Habr Career"` and
   `"RemoteOK"` to their strategies; `getStrategy` is now a lookup.
6. Updated `CLAUDE.md`'s Data Sources table (remoteok row) and surrounding prose, `ARCHITECTURE.md`'s
   `CrawlStrategy` key-interfaces entry, and `README.md` (new Increment 4 section, "Not yet
   implemented" list).

## Verification (manual, per CLAUDE.md's Testing Philosophy)

- [x] `npm install` succeeded; Puppeteer's bundled Chromium launches without extra OS setup on the
      dev machine (smoke-tested directly before writing any strategy code).
- [x] Spike confirmed a live Puppeteer navigation gets real content (200), not a 403, using the
      chosen UA.
- [x] Triggered a real RemoteOK crawl via `POST /sources/1/crawl`; `CrawlRun` went
      `RUNNING` → `COMPLETED`, `CrawlLog` showed real progress ("fetched listing (cache: miss, 50
      vacancies)"), not the old "not yet implemented" WARN.
- [x] Confirmed vacancies in Elasticsearch (`GET /crawler_results/_search`) with sane
      `title`/`company`/`url`/`postedAt`, clean plain-text `description` (no leftover `<br>`/
      `<strong>` tags), deduped `skillsSummary`, `isRemote: true`.
- [x] Re-ran the RemoteOK crawl a second time within the page-cache TTL; confirmed no regression
      from the `htmlToText` extraction (description now correctly flattened).
- [x] Re-crawled `habr_career`; confirmed listing + `enrichDetails` both still function after the
      rename and the shared-helper extraction (stopped mid-run once the regression check was
      satisfied, to avoid unnecessary load against the live site for a smoke test).
- [x] Confirmed `WeWorkRemotely` still logs its `WARN`-and-skip path unchanged.
- [x] Confirmed (via `grep`) the frontend renders `skillsSummary` as an opaque string with no
      shape assumptions — no UI changes needed.
- [ ] Visual check of the Source detail page's vacancy list for RemoteOK in an actual browser
      (API-level verification above covers correctness; a UI screenshot pass is still worth doing
      before merge).
- [ ] Confirm the Stop button's cooperative-cancellation behavior specifically for a RemoteOK run
      in progress (not exercised in this pass — RemoteOK's `crawl()` is short enough, ~5s, that it
      completed before a stop could meaningfully land mid-navigation).

## Risk: rate limiting / IP bans during development

RemoteOK's own `robots.txt` states `Crawl-delay: 1`, but the seeded `defaultDelayMs` is `11000`
(11s) — already far more conservative. During the spike, iterated primarily against fresh
Puppeteer navigations rather than the Redis page cache (needed to see real DOM structure each
time), but kept the sample small (a handful of navigations total) rather than looping. No
403/CAPTCHA was encountered during development. Future iteration on `remoteOkStrategy.ts`'s
parsing logic should prefer the existing page cache (`getOrFetch`, 1h TTL) over live re-fetches
where possible.

## Out of scope

- Salary field (deferred; also confirmed not worth adding as real data given the boilerplate
  finding above).
- Automated tests — no crawler tests exist for habr_career either, consistent with the project's
  manual-testing-first philosophy.
- Faceted search over individual skill tags (would need a real array field + separate schema
  decision from the comma-joined string used here).
- Containerizing the API / Puppeteer-in-Docker.
- `weworkremotely` and `craigslist` strategies — remain deferred per `CLAUDE.md`.
- Enforcing `respectRobotsTxt` in code (remains decorative, unchanged).

## Implementation steps

- [x] Spike: launched Puppeteer against real RemoteOK URLs, confirmed selectors/JSON shape,
      detail-crawl unnecessary, no real pagination on this endpoint.
- [x] Added `puppeteer` dependency; resolved resulting audit warnings.
- [x] Renamed `axiosCheerioStrategy.ts` → `habrCareerStrategy.ts`.
- [x] Extracted shared `htmlToText.ts` helper; updated `habrCareerStrategy.ts` to use it.
- [x] Wrote `remoteOkStrategy.ts` (`crawl()` only, no `enrichDetails`).
- [x] Refactored `getStrategy()` in `crawler/index.ts` to a name-keyed map with both strategies.
- [x] Updated `CLAUDE.md`, `ARCHITECTURE.md`, `README.md`.
- [x] Ran backend manual verification against the live stack (API + Postgres + Redis + ES).
- [ ] Visual/browser pass on the Source detail page for RemoteOK (see Verification above).
