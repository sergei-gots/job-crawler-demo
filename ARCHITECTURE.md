# ARCHITECTURE.md — JobCrawler Demo

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
   │                    workers (job runner / queue consumer)         │
   └───┬───────────────┬─────────────────┬────────────────┬─────────┘
       │               │                 │                │
       ▼               ▼                 ▼                ▼
  PostgreSQL        Redis          Elasticsearch      Claude API
  (users, jobs,   (rate limit,   (crawled results,   (enrichment,
   job logs)       job queue)      search index)       mocked first)
```

## Data flow (one crawler job)

1. User creates a **CrawlerJob** (name, sources, keywords, config) → stored in PostgreSQL.
2. User starts the job → a task is enqueued in **Redis**; status → `queued`.
3. A **worker** picks it up (status → `running`), and for each selected source:
   - checks `robots.txt` and applies **Redis** rate limiting,
   - fetches pages with **Axios/Cheerio** (or **Puppeteer** if `usePuppeteer`),
   - parses postings into raw **CrawlerResult** objects,
   - passes each through the **AIEnricher** (mock → real Claude) for summary/skills/category,
   - indexes the enriched result into **Elasticsearch**,
   - writes progress + **JobLog** lines to PostgreSQL.
4. Job finishes → status → `completed` (or `stopped` / `failed`).
5. User searches results via the **Coveo-like layer** (facets + relevance) over Elasticsearch.

## Storage responsibilities

| Store          | Owns                                                            |
|----------------|----------------------------------------------------------------|
| PostgreSQL     | `User`, `CrawlerJob`, `JobLog` (relational, source of truth)   |
| Elasticsearch  | `CrawlerResult` (crawled + enriched data, search index)        |
| Redis          | Rate-limit counters, job queue, transient job state, caching   |

## Data models

### User (PostgreSQL)
| Field         | Type        | Notes                          |
|---------------|-------------|--------------------------------|
| id            | uuid (PK)   |                                |
| email         | string      | unique                         |
| passwordHash  | string      | bcrypt/argon2                  |
| createdAt     | timestamp   |                                |
| updatedAt     | timestamp   |                                |

### CrawlerJob (PostgreSQL)
| Field         | Type                | Notes                                             |
|---------------|---------------------|---------------------------------------------------|
| id            | uuid (PK)           |                                                   |
| userId        | uuid (FK → User)    | ownership                                         |
| name          | string              |                                                   |
| sources       | string[]            | source keys, e.g. `['habr_career','craigslist']`  |
| keywords      | string[]            | search terms / filters                            |
| config        | jsonb               | `{ delayMs, maxDepth, usePuppeteer }`             |
| status        | enum                | `created`,`queued`,`running`,`completed`,`stopped`,`failed` |
| progress      | jsonb               | `{ processed, total, percent }`                   |
| createdAt     | timestamp           |                                                   |
| startedAt     | timestamp \| null   |                                                   |
| finishedAt    | timestamp \| null   |                                                   |

### CrawlerResult (Elasticsearch)
| Field          | Type        | Notes                                    |
|----------------|-------------|------------------------------------------|
| id             | string (PK) |                                          |
| jobId          | string      | which job produced it                    |
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
| Field      | Type              | Notes                        |
|------------|-------------------|------------------------------|
| id         | uuid (PK)         |                              |
| jobId      | uuid (FK → Job)   |                              |
| userId     | uuid              | for quick ownership checks   |
| level      | enum              | `info`,`warn`,`error`        |
| message    | string            |                              |
| meta       | jsonb \| null     | structured context           |
| timestamp  | timestamp         |                              |

## Key interfaces (to keep things swappable)

- **`CrawlStrategy`** — `crawl(source, job): Promise<RawResult[]>`; implementations:
  `AxiosCheerioStrategy`, `PuppeteerStrategy`. Chosen per job via `usePuppeteer`.
- **`AIEnricher`** — `enrich(raw): Promise<Enrichment>`; implementations:
  `MockAIEnricher` (now), `ClaudeEnricher` (later). Swapped via config/env.
- **`SearchService`** (Coveo-like) — `search(query, facets, sort): Promise<SearchResponse>`
  wrapping Elasticsearch; hides ES query DSL from controllers.
