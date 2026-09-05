# ARCHITECTURE.md — Job-Crawler-Demo

> High-level architecture and data models. For scope, standards and stack see `CLAUDE.md`.
> This file describes the **current/target** state of the system as of Increment 3c (Separate
> Crawling from Search, faceted search, search autocomplete) — for how earlier increments got
> here, and decisions that were locked along the way, see `.claude/features/`.

## Component overview

```
                         ┌─────────────────────────┐
                         │   apps/web (Next.js)     │
                         │   FSD dashboard, JWT      │
                         └────────────┬────────────┘
                                      │ REST (Bearer JWT)
                                      ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                     apps/api (Express)                          │
   │                                                                 │
   │  auth ──▶ controllers ──▶ services ──┬─▶ crawler ─┬─ Puppeteer  │
   │                                       │            └─ Axios/Cheerio
   │                                       ├─▶ ai (AIEnricher, not yet built) │
   │                                       └─▶ search (Coveo-like)    │
   │                    crawl runner (fire-and-forget, in-process)   │
   └───┬───────────────┬─────────────────┬────────────────┬─────────┘
       │               │                 │                │
       ▼               ▼                 ▼                ▼
     PostgreSQL          Redis          Elasticsearch      Claude API
  (users, crawl     (rate limit,     (crawled vacancies,  (enrichment,
   sources, crawl    page cache)       search index)        not yet built)
   runs, crawl logs)
```

## Data flow (one crawl run)

> **Status**: steps 1–4 and 6 below are implemented for `habr_career` (Axios+Cheerio listing crawl
> + per-vacancy detail crawl + faceted search). Step 5 (AI enrichment) is not implemented — no
> `AIEnricher` code exists yet, mocked or otherwise.
> See `.claude/features/02_FEATURE_REAL_CRAWLER_REDIS_ES.md`,
> `.claude/features/02b_FEATURE_VACANCY_DETAIL_CRAWL.md`, and
> `.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md` for how this evolved and what's next.

1. Any logged-in user triggers a crawl of a **CrawlSource** (`POST /sources/:id/crawl`, or "crawl
   all") — crawling is a shared, global operation, not owned per user (see `CLAUDE.md`'s Security
   Considerations). A **CrawlRun** row is created; status → `RUNNING`.
2. The **crawl runner** (in-process, fire-and-forget — no queue/worker pool) picks the matching
   `CrawlStrategy` for the source via `getStrategy(source)`. A source without a real strategy yet
   logs a `WARN` `CrawlLog` and is skipped rather than failing.
3. The strategy fetches the listing page(s), capped at `maxVacanciesToCrawl` vacancies (a source
   with real pagination like `habr_career` stops requesting further pages once the cap is
   reached; a source with a single one-shot listing fetch just truncates it), respecting **Redis**
   rate limiting (`defaultDelayMs`, keyed by `sourceId`) and a short-TTL Redis page cache; parses
   vacancies; upserts each into **Elasticsearch**, deduplicated by `sourceId:externalId`.
4. If the strategy has an `enrichDetails` step (currently only `habr_career`'s does), it then
   fetches each vacancy's own detail page (same rate limiter/cache) and merges in richer fields
   (`description`, `location`, `isRemote`, `skillsSummary`). Progress is written as `CrawlLog`
   rows throughout (one line per page/vacancy, not just a start/end summary).
5. *(Not yet built)* Each result would pass through an **AIEnricher** (`MockAIEnricher` → real
   Claude API) for summary/skill-extraction/categorization before/alongside indexing.
6. Users search the shared corpus via a **Coveo-like layer** (`GET /vacancies/search` — free text
   over title/company/description plus facets: Specialization, Seniority level, Remote/On-site,
   Location, Company, each with `terms`-aggregation bucket counts, and server-side `page`/`pageSize`
   pagination) over Elasticsearch — not scoped to any run or user. The search box also offers
   autocomplete: `GET /vacancies/suggest` (Increment 3c) returns distinct `title`/`company` values
   matching a case-insensitive prefix, to help formulate a query rather than replace the results.
7. The run finishes → `CrawlRun.status` → `COMPLETED` (or `FAILED`/`STOPPED`).

## Storage responsibilities

| Store          | Owns                                                                |
|----------------|----------------------------------------------------------------------|
| PostgreSQL     | `User`, `CrawlSource`, `CrawlListing`, `CrawlRun`, `CrawlLog` (relational, source of truth) |
| Elasticsearch  | `CrawlerResult` (crawled + eventually AI-enriched vacancies, search index) |
| Redis          | Rate-limit counters (per source), short-TTL raw-page cache            |

## Data models

### User (PostgreSQL)
| Field         | Type            | Notes                                                    |
|---------------|-----------------|-----------------------------------------------------------|
| id            | uuid (PK)       |                                                           |
| email         | string          | unique; editable via `PATCH /users/me` (re-checked for uniqueness, requires `currentPassword`) |
| passwordHash  | string          | bcrypt                                                   |
| name          | string \| null  | nullable at signup (registration only collects email/password); required when submitting a profile edit (enforced by the `PATCH /users/me` request schema, not a DB constraint) |
| createdAt     | timestamp       |                                                           |
| updatedAt     | timestamp       |                                                           |

`User` has no relation to crawling or search data — both are shared/global, not per-user (see
`CLAUDE.md`'s Security Considerations).

### CrawlSource (PostgreSQL)
| Field            | Type          | Notes                                              |
|------------------|---------------|-----------------------------------------------------|
| id               | int (PK)      | autoincrement                                      |
| name             | string        | unique; seeded, not user-editable                  |
| baseUrl          | string        |                                                     |
| isActive         | boolean       | default `true`                                     |
| defaultDelayMs   | int           | default `2000`; per-source rate-limit interval; user-editable (1000-20000 ms) via `PATCH /sources/:id` |
| maxVacanciesToCrawl | int        | default `25`; caps how many vacancies from a crawl's listing pass get enriched/upserted, regardless of how (or whether) the source paginates its listing; user-editable (1-200) via `PATCH /sources/:id` for every source — replaced the earlier `maxPagesToCrawl`/`supportsPageLimit` pair, which only made sense for sources with real page-based pagination |
| createdAt        | timestamp     |                                                     |
| updatedAt        | timestamp     |                                                     |

There is deliberately no stored `type`/technology field. Which library each strategy uses (Axios+Cheerio vs. Puppeteer) is fully determined by the `CrawlStrategy` module dispatched for that source (`crawler/index.ts`'s `getStrategy`) — a separate DB column repeating that fact could drift from the code without anything catching it (and did, for `weworkremotely` mid-Increment 6, before the column was removed). The API instead computes a `strategyDescription: string | null` per source at response time straight from `CrawlStrategy.description` (a field on the strategy object itself, living next to the `crawl()`/`enrichDetails()` it describes) — `null` for a source with no implemented strategy yet. The same pattern extends to `strategySteps: StrategyStep[]` (from `CrawlStrategy.steps`, Increment 7) — the step-by-step chain (what was tried, what broke, what fixed it) rendered as an in-app flowchart on the Source detail page and the Sources list's "Strategies" comparison panel; a source with no strategy gets a small generic 2-step fallback ("crawl triggered" → "not implemented"), not source-specific research prose, which stays in the `data-sources` skill only.

There is also deliberately no `respectRobotsTxt` field anymore — it was removed alongside `type`
for the same reason: it had zero consumers anywhere in the codebase (not read by any crawl logic,
not displayed in the UI, not even referenced in seed data beyond its DB default), so it recorded
nothing real. Each source's actual `robots.txt` findings (what's disallowed, what a strategy
respects) are manually researched and documented per source in the `data-sources` skill and that
source's feature doc instead — real, checkable facts, not a boolean that implied an enforcement
mechanism which doesn't exist in code.

### CrawlListing (PostgreSQL, Increment 9)
| Field     | Type                       | Notes                                                |
|-----------|----------------------------|-------------------------------------------------------|
| id        | int (PK)                   | autoincrement                                          |
| sourceId  | int (FK → CrawlSource.id)  | cascade-deletes with its source                        |
| label     | string                     | e.g. "Full-Stack"; seeded, not user-editable            |
| subPath   | string                     | e.g. "/categories/remote-full-stack-programming-jobs"; resolved against the parent source's `baseUrl` at crawl time, not stored as an absolute URL |
| isActive  | boolean                    | default `true`; user-editable via `PATCH /sources/:id/listings/:listingId` (immediate-apply checkbox, no Save button) |
| createdAt | timestamp                  |                                                         |
| updatedAt | timestamp                  |                                                         |

A named, independently-crawlable sub-target of a source — additive, not a forced 1-per-source
minimum: some sources (`Habr Career`, `RemoteOK`) have none and crawl exactly as before.
`WeWorkRemotely` and `Craigslist` each require one (their strategies throw if crawled with
`listing: null`) — see `.claude/features/09_FEATURE_CRAWL_LISTINGS.md` and
`.claude/features/10_FEATURE_CRAIGSLIST.md`. `@@unique([sourceId, subPath])`.

### CrawlRun (PostgreSQL)
| Field          | Type                          | Notes                                        |
|----------------|-------------------------------|------------------------------------------------|
| id             | int (PK)                      | autoincrement                                  |
| sourceId       | int (FK → CrawlSource.id)     | which source this run crawled                  |
| listingId      | int \| null (FK → CrawlListing.id) | set for a listing-scoped run (Increment 9), `null` for a source-level one; cascade-deletes with its `CrawlListing` |
| status         | enum                          | `PENDING`,`RUNNING`,`COMPLETED`,`FAILED`,`STOPPED` |
| vacanciesFound | int                           | default `0`; count from the listing pass       |
| startedAt      | timestamp \| null             |                                                 |
| finishedAt     | timestamp \| null             |                                                 |
| createdAt      | timestamp                     |                                                 |
| updatedAt      | timestamp                     |                                                 |

At most one non-finished (`RUNNING`) `CrawlRun` per **concurrency slot** at a time — enforced by a
status-conditioned write plus an in-process cancellation map, the same pattern the removed
`CrawlerJob` used to enforce per-job. A slot is `listingId ?? sourceId` (Increment 9's
`slotKeyFor` in `crawlRunner.ts`): a source without listings has one slot (its `sourceId`); a
source with listings has one independent slot per listing, so different listings of the same
source can crawl concurrently.

### CrawlerResult (Elasticsearch, index `crawler_results`)
| Field          | Type          | Notes                                                |
|----------------|---------------|--------------------------------------------------------|
| sourceId       | int           |                                                         |
| externalId     | keyword       | source's own vacancy id; `_id` = `sourceId:externalId` |
| title          | text          | also has a `.suggest` sub-field (Increment 3c, lowercase-normalized keyword) for autocomplete prefix matching |
| company        | text          | also has `.keyword` (Increment 3b, facet aggregation, original-case) and `.suggest` (Increment 3c, lowercase-normalized, autocomplete) sub-fields |
| url            | keyword       | original posting URL                                   |
| postedAt       | date \| null  | as reported by the source                              |
| firstSeenAt    | date          | set once, on first upsert                              |
| lastSeenAt     | date          | bumped on every re-crawl                               |
| description    | text          | plain text (HTML stripped), from the detail page       |
| location       | text \| null  | also has a `.keyword` sub-field (Increment 3b) for facet aggregation, alongside the full-text `location` field |
| isRemote       | boolean \| null |                                                       |
| skillsSummary  | text \| null  | source's own auto-generated skills sentence, raw (not split into an array — see `02b_FEATURE_VACANCY_DETAIL_CRAWL.md`) |
| specialization | keyword \| null | Increment 3b — parsed from the same lead-sentence template as `skillsSummary` |
| seniority      | keyword \| null | Increment 3b — parsed from the same lead-sentence template as `skillsSummary` |

`title.suggest`/`company.suggest` are deliberately separate from `company.keyword`: the facet field
must stay original-case and exact (it drives the Company facet's filter/display), while the
autocomplete sub-fields use a custom `lowercase_normalizer` for case-insensitive prefix matching —
mixing the two into one sub-field would corrupt the facet. No
`salary` field — deliberately not collected; see `02b_FEATURE_VACANCY_DETAIL_CRAWL.md`'s spike
findings (habr almost never discloses it, and the only visible number is a market estimate, not
the employer's own figure). No `userId`/`jobId` — the corpus is shared, not scoped to a run or
user. AI-enrichment fields (`summary`, `skills[]`, `category`) are not yet part of this schema —
they'll be added as part of the increment that actually builds `AIEnricher`.

### CrawlLog (PostgreSQL)
| Field      | Type                   | Notes                            |
|------------|------------------------|-----------------------------------|
| id         | int (PK)               | autoincrement                    |
| runId      | int (FK → CrawlRun.id) | which crawl run this line belongs to |
| level      | enum                   | `INFO`,`WARN`,`ERROR`            |
| message    | string                 |                                   |
| createdAt  | timestamp              |                                   |

## Key interfaces (to keep things swappable)

- **`CrawlStrategy`** (`apps/api/src/crawler/types.ts`) — a required `description: string` (a
  short human-readable summary of how the strategy actually fetches data, surfaced via the API as
  `strategyDescription` — see the CrawlSource table note above), a required `steps:
  StrategyStep[]` (the traceable chain of what was tried/broke/fixed, surfaced as
  `strategySteps` — see `.claude/features/07_FEATURE_STRATEGY_DIAGRAMS.md`) plus `crawl(source,
  listing): Promise<CrawlResult>` and an optional `enrichDetails(source, listing, vacancies,
  isCancelled, logProgress): Promise<EnrichDetailsResult>` for sources that support a second,
  per-vacancy detail-page pass. `listing: CrawlListing | null` (Increment 9) is the specific
  `CrawlListing` sub-target being crawled, `null` for sources without any — `habrCareerStrategy`/
  `remoteOkStrategy` ignore it, `weWorkRemotelyStrategy` requires it non-null. Chosen per source
  via `getStrategy(source)`, which dispatches purely on `CrawlSource.name` — not configurable per
  run. Strategy files are named after the site they
  crawl, not the fetch/parse library, since a strategy is 1:1 with a source and the library is an
  implementation detail: `habrCareerStrategy.ts` (Axios+Cheerio throughout — `habr_career`'s
  listing and detail pages are both server-rendered), `remoteOkStrategy.ts` (Puppeteer, listing
  only — Increment 4 — `remoteok`'s listing needs a real browser to get past a Cloudflare 403 on
  plain requests), and `weWorkRemotelyStrategy.ts` (Puppeteer for the listing, an RSS feed via
  plain Axios for detail enrichment — Increment 6 — see `06_FEATURE_WEWORKREMOTELY_AND_VACANCY_
  CAP.md` for why the detail pass isn't Puppeteer too).
- **`AIEnricher`** — *not yet implemented*. Planned interface: `enrich(raw): Promise<Enrichment>`;
  planned implementations: `MockAIEnricher` first, `ClaudeEnricher` (real Claude API) later,
  swapped via config/env.
- **`searchVacancies`** (Coveo-like, Increment 3b — `apps/api/src/search/queryVacancies.ts`) —
  `searchVacancies(filters): Promise<VacancySearchResult>` wrapping Elasticsearch: free-text
  `multi_match` over title/company/description + `terms` facet filters + `terms` aggregations for
  facet counts, plus `page`/`pageSize` → ES `from`/`size` with `track_total_hits: true`, returning
  the exact `total` alongside `hits`/`facets`. No relevance-sort control yet (ES's default `_score`
  ordering only); hides ES query DSL from the `vacancies` module's controller/service.
- **`suggestVacancies`** (Increment 3c — `apps/api/src/search/suggestVacancies.ts`) —
  `suggestVacancies(prefix): Promise<VacancySuggestion[]>`, backing `GET /vacancies/suggest`.
  Prefix `terms` aggregations (min. 2 characters) on `title.suggest`/`company.suggest`, each with a
  `top_hits` sub-aggregation to recover the original-case display value; results are deduped and
  tagged `field: "title" | "company"`. Deliberately not `queryVacancies.ts` — kept as its own module
  since it's a distinct query shape (aggregation-only, no hits), though both live in `search/` and
  are wired through the same `vacancies` controller/service module.
