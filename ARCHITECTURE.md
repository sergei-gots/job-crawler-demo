# ARCHITECTURE.md — Job-Crawler-Demo

> High-level architecture and data models. For scope, standards and stack see `CLAUDE.md`.

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
   │                                       ├─▶ ai (AIEnricher)        │
   │                                       └─▶ search (Coveo-like)    │
   │                    workers (crawler job runner / queue consumer) │
   └───┬───────────────┬─────────────────┬────────────────┬─────────┘
       │               │                 │                │
       ▼               ▼                 ▼                ▼
     PostgreSQL          Redis          Elasticsearch      Claude API
  (users, crawler   (rate limit,     (crawled results,   (enrichment,
   jobs, crawler     crawler job       search index)       mocked first)
   job logs)          queue)
```

## Data flow (one crawler job)

> **Increment 1 status:** steps 1–2 and 4 below are implemented. Step 3 (the actual crawl) is
> currently a **mock in-process runner** (`apps/api/src/crawler-jobs/crawler-jobs.runner.ts`) that
> writes timed `JobLog` rows and flips the crawler job status — no real Redis queue, `robots.txt` check,
> Axios/Cheerio/Puppeteer fetch, AI enrichment, or Elasticsearch indexing yet. Step 5 (search) is
> not implemented. This section describes the target end-state; see `.claude/features/
> FEATIRE_SOURCES_AND_JOBS.md` for what's real today.

1. User creates a **CrawlerJob** (name, sources, keywords) → stored in PostgreSQL.
2. User starts the crawler job → a task is enqueued in **Redis**; status → `RUNNING`.
3. A **worker** picks it up, and for each selected source:
   - checks `robots.txt` and applies **Redis** rate limiting (using that `CrawlSource`'s own
     `defaultDelayMs` — crawl strategy and pacing are per-source, not configurable per crawler job),
   - fetches pages with **Axios/Cheerio** (or **Puppeteer**, depending on that source's `type`),
   - parses postings into raw **CrawlerResult** objects,
   - passes each through the **AIEnricher** (mock → real Claude) for summary/skills/category,
   - indexes the enriched result into **Elasticsearch**,
   - writes progress + **JobLog** lines to PostgreSQL.
4. Crawler job finishes → status → `COMPLETED` (or `FAILED` if it errored, `STOPPED` if the user
   stopped it).
5. User searches results via the **Coveo-like layer** (facets + relevance) over Elasticsearch.

## Storage responsibilities

| Store          | Owns                                                            |
|----------------|----------------------------------------------------------------|
| PostgreSQL     | `User`, `CrawlerJob`, `JobLog` (relational, source of truth)   |
| Elasticsearch  | `CrawlerResult` (crawled + enriched data, search index)        |
| Redis          | Rate-limit counters, crawler job queue, transient crawler job state, caching |

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

### CrawlSource (PostgreSQL)
| Field            | Type          | Notes                                              |
|------------------|---------------|-----------------------------------------------------|
| id               | int (PK)      | autoincrement                                      |
| name             | string        | unique; seeded, not user-editable in Increment 1   |
| baseUrl          | string        |                                                     |
| type             | enum          | `STATIC` (Axios/Cheerio) \| `DYNAMIC` (Puppeteer)  |
| isActive         | boolean       | default `true`                                     |
| respectRobotsTxt | boolean       | default `true` (not yet enforced by the mock runner) |
| defaultDelayMs   | int           | default `2000`                                     |
| createdAt        | timestamp     |                                                     |
| updatedAt        | timestamp     |                                                     |

### CrawlerJob (PostgreSQL)
| Field         | Type                     | Notes                                             |
|---------------|--------------------------|----------------------------------------------------|
| id            | int (PK)                 | autoincrement                                      |
| userId        | uuid (FK → User.id)      | ownership                                          |
| name          | string                   |                                                     |
| description   | string \| null           |                                                     |
| sources       | jsonb (`number[]`)       | selected `CrawlSource.id`s                         |
| keywords      | string \| null           | free-text filter                                   |
| status        | enum                     | `PENDING`,`RUNNING`,`COMPLETED`,`FAILED`,`STOPPED` |
| lastRunAt     | timestamp \| null        |                                                     |
| createdAt     | timestamp                |                                                     |
| updatedAt     | timestamp                |                                                     |

### CrawlerResult (Elasticsearch)
| Field          | Type        | Notes                                    |
|----------------|-------------|------------------------------------------|
| id             | string (PK) |                                          |
| jobId          | string      | which crawler job produced it            |
| userId         | string      | ownership (for filtered search)          |
| source         | string      | source key                               |
| sourceUrl      | string      | original posting URL                     |
| title          | string      | job title                                |
| company        | string \| null |                                       |
| location       | string \| null |                                       |
| salary         | string \| null | raw text (normalization is post-MVP)  |
| description    | text        | raw posting text                         |
| **summary**    | text        | AI-enriched                              |
| **skills**     | string[]    | AI-extracted technologies/skills         |
| **category**   | string      | AI-assigned category                     |
| crawledAt      | timestamp   |                                          |

> Fields in **bold** are produced by the `AIEnricher`. Facets in the Coveo-like layer are built
> on `skills`, `location`, `company`, and (later) normalized salary.

### JobLog (PostgreSQL)
| Field      | Type                  | Notes                            |
|------------|-----------------------|-----------------------------------|
| id         | int (PK)              | autoincrement                    |
| jobId      | int (FK → CrawlerJob.id) | ownership checked via the crawler job's `userId` |
| level      | enum                  | `INFO`,`WARN`,`ERROR`            |
| message    | string                |                                   |
| createdAt  | timestamp             |                                   |

## Key interfaces (to keep things swappable)

- **`CrawlStrategy`** — `crawl(source, job): Promise<RawResult[]>`; implementations:
  `AxiosCheerioStrategy`, `PuppeteerStrategy`. Chosen per source via `CrawlSource.type`
  (`STATIC` → Axios/Cheerio, `DYNAMIC` → Puppeteer) — not configurable per crawler job.
- **`AIEnricher`** — `enrich(raw): Promise<Enrichment>`; implementations:
  `MockAIEnricher` (now), `ClaudeEnricher` (later). Swapped via config/env.
- **`SearchService`** (Coveo-like) — `search(query, facets, sort): Promise<SearchResponse>`
  wrapping Elasticsearch; hides ES query DSL from controllers.
