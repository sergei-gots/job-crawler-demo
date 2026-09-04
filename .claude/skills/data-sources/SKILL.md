---
name: data-sources
description: Use when adding, editing, or discussing a crawl source or CrawlStrategy (habr_career, remoteok, weworkremotely, craigslist) — covers per-source implementation status, why each strategy was built the way it was, robots.txt/Cloudflare findings, and the retired moikrug source. Triggers on "new source", "crawl strategy", "CrawlStrategy", or any of the source names themselves.
---

# Data Sources

Given the original 2-week timeline, the plan was to do **one source well rather than three done
thinly**. In practice, the crawler abstraction built for the first source (`habr_career`)
generalized cleanly to a second, structurally different source (`remoteok`, Increment 4) without
any changes to [`crawlRunner.ts`](/apps/api/src/crawler/crawlRunner.ts) or the `CrawlStrategy`
interface — see [`04_FEATURE_PUPPETEER_REMOTEOK.md`](/.claude/features/04_FEATURE_PUPPETEER_REMOTEOK.md)
— so two sources are implemented today. `weworkremotely` and `craigslist` remain deferred: they're
seeded as selectable `CrawlSource` rows, but have no parser yet (see below).

| Key              | Site                     | Status          | Type (`CrawlSource.type`)                                     | Notes                                                        |
| ---------------- | ------------------------ | --------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| `habr_career`    | [career.habr.com](https://career.habr.com)          | **Implemented** (Increment 1–2.2) | `STATIC` — confirmed fully server-rendered (both the listing and, per Increment 2.2, the vacancy detail pages); crawled with Axios+Cheerio, no Puppeteer needed | RU tech jobs; good fit for AI skill-extraction demo |
| `remoteok`       | [remoteok.com](https://remoteok.com)             | **Implemented** (Increment 4) | `DYNAMIC` — confirmed the site returns `403` on a plain non-browser request (Cloudflare bot check); crawled with Puppeteer (a real desktop-Chrome UA, not a bot-identifying string) to get past the wall | Tech jobs with ready-made skill tags; listing page alone carries everything needed (description, tags) via per-row JSON-LD, so no detail-page crawl. `baseSalary`/location in that JSON-LD are boilerplate placeholders (identical across every row), not real per-employer data — not stored, same reasoning as habr's dropped salary field; replaces `moikrug` |
| `weworkremotely` | [weworkremotely.com](https://weworkremotely.com)       | Deferred, no parser yet | `STATIC` — `robots.txt` is `Allow: /` aside from account/admin paths; listings confirmed server-rendered on a manual check | Simple, long-established scraper-friendly job board |
| `craigslist`     | [craigslist.org](https://craigslist.org) (SW jobs) | Deferred, no parser yet | `STATIC` — listings are server-rendered and accessible without login on a single request, but craigslist has a documented history of legal/technical enforcement against scrapers (e.g. the 3taps/PadMapper case); expect rate-limiting or CAPTCHA under sustained automated access even though a one-off check looks simple | International example, multiple cities |

`moikrug` is gone as a distinct source — `moikrug.ru` now permanently redirects (301, both
`robots.txt` and the site itself) to `career.habr.com`; Habr absorbed it. Replaced by `remoteok`
and `weworkremotely` above.

`weworkremotely` and `craigslist` are deferred — add them later as additional `CrawlStrategy`
adapters if time allows, without changing the crawler architecture.

All four are already seeded as `CrawlSource` rows ([`apps/api/prisma/seed.ts`](/apps/api/prisma/seed.ts))
so they're selectable on the Sources page. `habr_career` and `remoteok` have real `CrawlStrategy`
implementations ([`habrCareerStrategy.ts`](/apps/api/src/crawler/strategies/habrCareerStrategy.ts)
— Axios+Cheerio, listing crawl plus per-vacancy detail crawl;
[`remoteOkStrategy.ts`](/apps/api/src/crawler/strategies/remoteOkStrategy.ts) — Puppeteer, listing
crawl only — see the "Real crawler...", "Vacancy detail crawl...", and "Puppeteer RemoteOK..."
features in [`/.claude/features/`](/.claude/features/)); `weworkremotely` and `craigslist` don't
have a parser yet, so triggering a crawl for them (or using "crawl all") logs a `WARN` and skips
them rather than failing the run. Strategy files are named after the site they crawl
(`<siteKeyCamelCase>Strategy.ts`), not the library used to fetch/parse it — the fetch/parse
technology (Axios+Cheerio vs. Puppeteer) is an implementation detail internal to each file.
Dispatch (`getStrategy` in [`apps/api/src/crawler/index.ts`](/apps/api/src/crawler/index.ts)) is by
`CrawlSource.name`, not by `CrawlSource.type` — `type` only signals "needs a browser or not," it
doesn't imply every source of the same type can share one strategy's selectors/navigation.
Crawling is triggered directly per source via `POST /sources/:id/crawl` — see
[`/.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md`](/.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md)
— there is no separate job entity that picks which sources to run.

For each source we define: `type` (`STATIC`/`DYNAMIC` — determines Axios+Cheerio vs Puppeteer),
`defaultDelayMs`, base URL, and (eventually) the CSS selectors/fields to parse. This all lives on
the `CrawlSource` itself; there's no separate per-run configuration. Always respect the site's
`robots.txt` and apply rate limiting.
