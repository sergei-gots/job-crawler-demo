---
name: data-sources
description: Use when adding, editing, or discussing a crawl source or CrawlStrategy (habr_career, remoteok, weworkremotely, craigslist) — covers per-source implementation status, why each strategy was built the way it was, robots.txt/Cloudflare findings, and the retired moikrug source. Triggers on "new source", "crawl strategy", "CrawlStrategy", or any of the source names themselves.
---

# Data Sources

Given the original 2-week timeline, the plan was to do **one source well rather than three done
thinly**. In practice, the crawler abstraction built for the first source (`habr_career`)
generalized cleanly to two structurally different sources (`remoteok`, Increment 4, and
`weworkremotely`, Increment 6) without any changes to
[`crawlRunner.ts`](/apps/api/src/crawler/crawlRunner.ts) or the `CrawlStrategy` interface — see
[`04_FEATURE_PUPPETEER_REMOTEOK.md`](/.claude/features/04_FEATURE_PUPPETEER_REMOTEOK.md) and
[`06_FEATURE_WEWORKREMOTELY_AND_VACANCY_CAP.md`](/.claude/features/06_FEATURE_WEWORKREMOTELY_AND_VACANCY_CAP.md)
— so three sources are implemented today. `craigslist` remains deferred: it's seeded as a
selectable `CrawlSource` row, but has no parser yet (see below).

There is no stored `type`/technology field on `CrawlSource` — see "Fetch mechanism" notes below;
each row's actual mechanism lives in its `CrawlStrategy.description` (in the strategy file itself,
surfaced via the API as `strategyDescription`), not a separate DB classification that could drift
from the code (see the `06_FEATURE_WEWORKREMOTELY_AND_VACANCY_CAP.md` "type field" decision for
why that column was removed mid-Increment-6). The same strategy object also carries
`steps: StrategyStep[]` (Increment 7, surfaced as `strategySteps`) — the step-by-step chain a
reader would trace through `crawl()`/`enrichDetails()`, rendered as an in-app flowchart.

**`steps` is hand-authored, not derived — it will NOT update itself.** Changing `crawl()`/
`enrichDetails()` without touching `steps` leaves the diagram silently describing behavior that
no longer exists (the exact drift risk this field was designed to avoid for the `description`
field doesn't extend to its *content* staying current over time). So: whenever a `CrawlStrategy`
file's actual crawling logic changes (a new spike finding, a new fix, a transport swap),
**explicitly ask the user whether `steps` needs updating before treating the change as done** —
don't silently update it and don't silently skip it. Update only the specific step(s) that
describe the part of the mechanism that actually changed — a targeted edit, not a full rewrite of
the chain, and not a reason to touch unrelated steps that are still accurate. See
`07_FEATURE_STRATEGY_DIAGRAMS.md`.

**Writing `StrategyStep` content** (`title`/`explanation`/`method`/`result` on each step):
1. Use only common, generally-understood terms — never a reference to a project-internal or
   since-removed classification. (Caught live: a step once said "...a reversal of this source's
   own earlier STATIC finding..." — "STATIC" meant the removed `CrawlSource.type` value, meaningless
   to a reader with no session history. Don't reintroduce this class of mistake.)
2. State the confirmed fact, not the authoring process — no "before doing X" / "before trusting
   Y" filler. Say what was found, not when it was checked during development.
3. Wrap a non-obvious abbreviation or raw technical value (e.g. a literal HTTP header value) in
   `{{term}}` and add a matching entry to `apps/web/entities/source/lib/strategy-glossary.ts` —
   never leave it silently unexplained, and never spell it out inline as a workaround instead of
   using the tooltip. Well-known technical vocabulary (JSON-LD, RSS, HTML, API) doesn't need
   this — reserve it for genuinely opaque strings like `cf-mitigated`.

| Key              | Site                     | Status          | Fetch mechanism                                     | Notes                                                        |
| ---------------- | ------------------------ | --------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| `habr_career`    | [career.habr.com](https://career.habr.com)          | **Implemented** (Increment 1–2.2) | Axios + Cheerio, listing and detail pages — confirmed fully server-rendered, no Puppeteer needed | RU tech jobs; good fit for AI skill-extraction demo |
| `remoteok`       | [remoteok.com](https://remoteok.com)             | **Implemented** (Increment 4) | Puppeteer, listing only — confirmed the site returns `403` on a plain non-browser request (Cloudflare bot check); crawled with a real desktop-Chrome UA, not a bot-identifying string, to get past the wall | Tech jobs with ready-made skill tags; listing page alone carries everything needed (description, tags) via per-row JSON-LD, so no detail-page crawl. `baseSalary`/location in that JSON-LD are boilerplate placeholders (identical across every row), not real per-employer data — not stored, same reasoning as habr's dropped salary field; replaces `moikrug` |
| `weworkremotely` | [weworkremotely.com](https://weworkremotely.com)       | **Implemented** (Increment 6) | Puppeteer for the listing (Cloudflare-gated — confirmed live 2026-09-04, `403` with `cf-mitigated: challenge` on plain curl/axios requests even with a realistic UA, on both the listing and detail page types) + the category's RSS feed via plain Axios for detail enrichment. The original design put both listing and detail through Puppeteer; a live run found headless Puppeteer got fingerprinted/degraded after the first successful detail-page navigation (1/5 succeeded) even though the pages themselves were fine when re-checked in a real browser — the RSS feed for the same category mirrors the HTML listing 1:1 by slug and isn't Cloudflare-gated at all, so it replaced the Puppeteer detail-page loop entirely | Category listing has no real pagination (`?page=2` returns identical rows to `?page=1`, both for the HTML page and its matching RSS feed) — bounded instead by `maxVacanciesToCrawl`, which is a ceiling on the category's current live posting count (~120), not a way to reach a deeper archive. As of Increment 9 the target URL comes from a `CrawlListing.subPath`, not a hardcoded constant — currently two seeded listings, `Full-Stack` → `/categories/remote-full-stack-programming-jobs` and `Backend` → `/categories/remote-back-end-programming-jobs` (see `.claude/features/09_FEATURE_CRAWL_LISTINGS.md`); adding another category means live-verifying its slug (and matching `.rss` feed) first, same as these were, then adding a seed entry |
| `craigslist`     | [craigslist.org](https://craigslist.org) (SW jobs) | Deferred, no parser yet | Listings are server-rendered and accessible without login on a single request, but craigslist has a documented history of legal/technical enforcement against scrapers (e.g. the 3taps/PadMapper case); expect rate-limiting or CAPTCHA under sustained automated access even though a one-off check looks simple | International example, multiple cities |

`moikrug` is gone as a distinct source — `moikrug.ru` now permanently redirects (301, both
`robots.txt` and the site itself) to `career.habr.com`; Habr absorbed it. Replaced by `remoteok`
and `weworkremotely` above.

`craigslist` is deferred — add it later as an additional `CrawlStrategy` adapter if time allows,
without changing the crawler architecture.

All four are already seeded as `CrawlSource` rows ([`apps/api/prisma/seed.ts`](/apps/api/prisma/seed.ts))
so they're selectable on the Sources page. `habr_career`, `remoteok`, and `weworkremotely` have
real `CrawlStrategy` implementations
([`habrCareerStrategy.ts`](/apps/api/src/crawler/strategies/habrCareerStrategy.ts) — Axios+Cheerio,
listing crawl plus per-vacancy detail crawl;
[`remoteOkStrategy.ts`](/apps/api/src/crawler/strategies/remoteOkStrategy.ts) — Puppeteer, listing
crawl only;
[`weWorkRemotelyStrategy.ts`](/apps/api/src/crawler/strategies/weWorkRemotelyStrategy.ts) —
Puppeteer for the listing, RSS feed via Axios for detail enrichment (see table above for why) —
see the "Real crawler...", "Vacancy detail crawl...", "Puppeteer RemoteOK...", and "WeWorkRemotely
and vacancy cap..." features in [`/.claude/features/`](/.claude/features/)); `craigslist` doesn't
have a parser yet, so triggering a crawl for it (or using "crawl all") logs a `WARN` and skips it
rather than failing the run. Strategy files are named after the site they crawl
(`<siteKeyCamelCase>Strategy.ts`), not the library used to fetch/parse it — the fetch/parse
technology is an implementation detail internal to each file, surfaced to the UI via
`CrawlStrategy.description` (see ARCHITECTURE.md's CrawlSource notes) rather than a stored
classification. Dispatch (`getStrategy` in
[`apps/api/src/crawler/index.ts`](/apps/api/src/crawler/index.ts)) is purely by `CrawlSource.name`
— `name` doubles as the dispatch key, so each strategy is 1:1 with a specific source, not a
category of sources. Crawling is triggered directly per source via `POST /sources/:id/crawl` — see
[`/.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md`](/.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md)
— there is no separate job entity that picks which sources to run.

For each source we define: `defaultDelayMs`, base URL, and (eventually) the CSS selectors/fields
to parse. This all lives on the `CrawlSource` itself; there's no separate per-run configuration.
Crawl volume is bounded by
`maxVacanciesToCrawl` (caps enriched/upserted vacancies per run, applied inside each strategy's
`crawl()` — a source with real pagination like `habr_career` stops requesting further listing
pages once the cap is reached, a source with a single one-shot listing fetch like `remoteok`/
`weworkremotely` truncates it), not by a page count — see
[`06_FEATURE_WEWORKREMOTELY_AND_VACANCY_CAP.md`](/.claude/features/06_FEATURE_WEWORKREMOTELY_AND_VACANCY_CAP.md)
for why the earlier `maxPagesToCrawl`/`supportsPageLimit` pair was replaced rather than extended.
Always respect the site's `robots.txt` and apply rate limiting.
