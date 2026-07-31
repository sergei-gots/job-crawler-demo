# ARCHITECTURE.md — Job-Crawler-Demo

> High-level architecture and data models. For scope, standards and stack see `CLAUDE.md`.
> This file describes the **current/target** state of the system as of Increment 3a (Separate
> Crawling from Search) — for how earlier increments got here, and decisions that were locked
> along the way, see `.claude/features/`.

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

> **Status**: steps 1–4 below are implemented for `habr_career` (Axios+Cheerio listing crawl +
> per-vacancy detail crawl). Step 5 (AI enrichment) is not implemented — no `AIEnricher` code
> exists yet, mocked or otherwise. Step 6 (Coveo-like search/facets) is planned for Increment 3b.
> See `.claude/features/02_FEATURE_REAL_CRAWLER_REDIS_ES.md`,
> `.claude/features/02b_FEATURE_VACANCY_DETAIL_CRAWL.md`, and
> `.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md` for how this evolved and what's next.

1. Any logged-in user triggers a crawl of a **CrawlSource** (`POST /sources/:id/crawl`, or "crawl
   all") — crawling is a shared, global operation, not owned per user (see `CLAUDE.md`'s Security
   Considerations). A **CrawlRun** row is created; status → `RUNNING`.
2. The **crawl runner** (in-process, fire-and-forget — no queue/worker pool) picks the matching
   `CrawlStrategy` for the source via `getStrategy(source)`. A source without a real strategy yet
   logs a `WARN` `CrawlLog` and is skipped rather than failing.
3. The strategy fetches the listing page(s) (bounded by `maxPagesToCrawl`), respecting **Redis**
   rate limiting (`defaultDelayMs`, keyed by `sourceId`) and a short-TTL Redis page cache; parses
   vacancies; upserts each into **Elasticsearch**, deduplicated by `sourceId:externalId`.
4. If the strategy has an `enrichDetails` step (currently only `habr_career`'s does), it then
   fetches each vacancy's own detail page (same rate limiter/cache) and merges in richer fields
   (`description`, `location`, `isRemote`, `skillsSummary`). Progress is written as `CrawlLog`
   rows throughout (one line per page/vacancy, not just a start/end summary).
5. *(Not yet built)* Each result would pass through an **AIEnricher** (`MockAIEnricher` → real
   Claude API) for summary/skill-extraction/categorization before/alongside indexing.
6. *(Increment 3b)* Users search the shared corpus via a **Coveo-like layer** (free text +
   facets: Specialization, Seniority level, Remote/On-site, Location, Company + relevance sorting)
   over Elasticsearch — not scoped to any run or user.
7. The run finishes → `CrawlRun.status` → `COMPLETED` (or `FAILED`/`STOPPED`).

## Storage responsibilities

| Store          | Owns                                                                |
|----------------|----------------------------------------------------------------------|
| PostgreSQL     | `User`, `CrawlSource`, `CrawlRun`, `CrawlLog` (relational, source of truth) |
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
| type             | enum          | `STATIC` (Axios/Cheerio) \| `DYNAMIC` (Puppeteer)  |
| isActive         | boolean       | default `true`                                     |
| respectRobotsTxt | boolean       | default `true`                                     |
| defaultDelayMs   | int           | default `2000`; per-source rate-limit interval     |
| maxPagesToCrawl  | int           | default `1`; bounds listing-page pagination depth per crawl |
| createdAt        | timestamp     |                                                     |
| updatedAt        | timestamp     |                                                     |

### CrawlRun (PostgreSQL)
| Field          | Type                       | Notes                                        |
|----------------|----------------------------|------------------------------------------------|
| id             | int (PK)                   | autoincrement                                  |
| sourceId       | int (FK → CrawlSource.id)  | which source this run crawled                  |
| status         | enum                       | `PENDING`,`RUNNING`,`COMPLETED`,`FAILED`,`STOPPED` |
| vacanciesFound | int                        | default `0`; count from the listing pass       |
| startedAt      | timestamp \| null          |                                                 |
| finishedAt     | timestamp \| null          |                                                 |
| createdAt      | timestamp                  |                                                 |
| updatedAt      | timestamp                  |                                                 |

At most one non-finished (`RUNNING`) `CrawlRun` per `sourceId` at a time — enforced by a
status-conditioned write plus an in-process cancellation map, the same pattern the removed
`CrawlerJob` used to enforce per-job.

### CrawlerResult (Elasticsearch, index `crawler_results`)
| Field          | Type          | Notes                                                |
|----------------|---------------|--------------------------------------------------------|
| sourceId       | int           |                                                         |
| externalId     | keyword       | source's own vacancy id; `_id` = `sourceId:externalId` |
| title          | text          |                                                         |
| company        | text          |                                                         |
| url            | keyword       | original posting URL                                   |
| postedAt       | date \| null  | as reported by the source                              |
| firstSeenAt    | date          | set once, on first upsert                              |
| lastSeenAt     | date          | bumped on every re-crawl                               |
| description    | text          | plain text (HTML stripped), from the detail page       |
| location       | text \| null  |                                                         |
| isRemote       | boolean \| null |                                                       |
| skillsSummary  | text \| null  | source's own auto-generated skills sentence, raw (not split into an array — see `02b_FEATURE_VACANCY_DETAIL_CRAWL.md`) |

No `salary` field — deliberately not collected; see `02b_FEATURE_VACANCY_DETAIL_CRAWL.md`'s spike
findings (habr almost never discloses it, and the only visible number is a market estimate, not
the employer's own figure). No `userId`/`jobId` — the corpus is shared, not scoped to a run or
user. AI-enrichment fields (`summary`, `skills[]`, `category`) and Increment 3b's facet fields
(`specialization`, `seniority`) are not yet part of this schema — they'll be added to this table
as part of the increments that actually build them, per `CLAUDE.md`'s "keep docs in sync" rule.

### CrawlLog (PostgreSQL)
| Field      | Type                   | Notes                            |
|------------|------------------------|-----------------------------------|
| id         | int (PK)               | autoincrement                    |
| runId      | int (FK → CrawlRun.id) | which crawl run this line belongs to |
| level      | enum                   | `INFO`,`WARN`,`ERROR`            |
| message    | string                 |                                   |
| createdAt  | timestamp              |                                   |

## Key interfaces (to keep things swappable)

- **`CrawlStrategy`** (`apps/api/src/crawler/types.ts`) — `crawl(source): Promise<CrawlResult>`
  plus an optional `enrichDetails(source, vacancies, isCancelled, logProgress):
  Promise<EnrichDetailsResult>` for sources that support a second, per-vacancy detail-page pass.
  Chosen per source via `getStrategy(source)` (dispatches on `CrawlSource.type`/`name`) — not
  configurable per run. Current implementation: `AxiosCheerioStrategy` (habr_career only).
  `PuppeteerStrategy` doesn't exist yet — no seeded source has needed it so far (`habr_career`'s
  listing turned out to be server-rendered despite being seeded as `DYNAMIC`).
- **`AIEnricher`** — *not yet implemented*. Planned interface: `enrich(raw): Promise<Enrichment>`;
  planned implementations: `MockAIEnricher` first, `ClaudeEnricher` (real Claude API) later,
  swapped via config/env.
- **`SearchService`** (Coveo-like, Increment 3b) — *not yet implemented*. Planned:
  `search(query, facets, sort): Promise<SearchResponse>` wrapping Elasticsearch (free-text
  `multi_match` + `terms` facet filters + `terms` aggregations for facet counts); hides ES query
  DSL from controllers.
