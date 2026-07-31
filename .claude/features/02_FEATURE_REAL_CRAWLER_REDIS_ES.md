# FEATURE: Real Crawler + Redis + Minimal Elasticsearch (Increment 2)

## Overview

Replaces the Increment 1 **mock** in-process runner with a real crawl of the MVP source, adds
Redis for source-level rate limiting and a short-TTL raw-page cache, and adds a minimal
Elasticsearch-backed vacancy store so crawled results are actually visible. Builds on
`.claude/features/01_FEATURE_SOURCES_AND_JOBS.md` (Sources and Crawler Jobs CRUD, Increment 1).

**Goal**: `POST /crawler-jobs/:id/start` performs a real Axios+Cheerio crawl of `habr_career`,
writes real progress to `JobLog`, stores parsed vacancies in Elasticsearch, and exposes them via
two read endpoints. AI enrichment and the full Coveo-like search/facet layer stay out of scope.

## Status

**Implemented and manually verified.** `apps/api/src/crawler/` (Axios+Cheerio strategy, Redis
rate limiter, Redis page cache) and `apps/api/src/search/` (Elasticsearch client, index, upsert,
queries) are real; `apps/api/src/crawler-jobs/crawler-jobs.runner.ts` performs a real crawl
instead of the Increment 1 mock timers. Verified end-to-end: a real crawl of `career.habr.com`
returns 25 vacancies, `JobLog` shows real fetch/parse progress, `GET /sources/:id/vacancies` and
`GET /crawler-jobs/:id/vacancies` return real data, a second run within the cache TTL shows a
cache hit with no ES duplicates, an unimplemented source (RemoteOK) logs a `WARN` and still
completes, and `POST /crawler-jobs/:id/start` now returns immediately (fire-and-forget) instead
of blocking on the crawl. AI enrichment and the full Coveo-like search/facet layer remain out of
scope, as planned.

## Terminology

The crawled item is a **vacancy** in prose/UI/routes/`JobLog` messages — chosen over
"posting"/"listing" because it matches `habr_career`'s own `/vacancies/{id}` URLs and is standard
UK/international English (also the formal term in `usajobs.gov`'s "vacancy announcements"). This
follows the same pattern already used for `CrawlerJob` (formal model name) vs. "Crawler Job" (UI
phrase): the formal Elasticsearch entity name stays `CrawlerResult`, already locked in
`ARCHITECTURE.md` — not renamed. "Vacancy" is the everyday word layered on top, in route paths,
log messages, and future UI copy.

## Scope decisions locked with the user

- **Source**: `habr_career` only, per `CLAUDE.md`'s "one source, done well" MVP scope. Craigslist,
  Moikrug (already gone — redirects to `career.habr.com`), WeWorkRemotely, and RemoteOK stay
  deferred/unused.
- **Spike result** (read-only `curl` against `career.habr.com/vacancies`, no JS execution): the
  listing is fully server-rendered — 25 `.vacancy-card` elements came back from a plain request.
  **Puppeteer is not needed.** `habr_career` is crawled with Axios+Cheerio even though its
  `CrawlSource.type` is currently seeded as `DYNAMIC` (this needed re-verifying per the note
  already in `CLAUDE.md`'s Data Sources table). `PuppeteerStrategy` is **not built this
  increment** — only `AxiosCheerioStrategy`, wired generically by `CrawlSource.type` so a future
  `DYNAMIC` source can add it later without touching the dispatcher.
- **Confirmed selectors** for `habr_career`:
  - card: `.vacancy-card`
  - title: `.vacancy-card__title-link` (text)
  - external id / URL: `href="/vacancies/{id}"` (also present as `.vacancy-card__backdrop-link`)
  - company: `.vacancy-card__company a` (text)
  - posted date: `.vacancy-card__date time.basic-date` → `datetime` attribute (ISO string)
- **Redis scope**: rate limiting (per-source min-delay, respecting `CrawlSource.defaultDelayMs`)
  + a short-TTL raw-page cache (avoids two concurrent crawler jobs re-fetching the same source
  page). No job queue/worker pool this increment — runner stays in-process, same shape as the
  mock.
- **Crawler Job vs. fetch are different levels**: every `CrawlerJob` run still gets its own full
  `JobLog` trail and status transition, even when its raw page came from cache instead of a fresh
  fetch.
- **Keys use `CrawlSource.id` (immutable), never `CrawlSource.name`**: `name` is unique but a
  mutable display label, not a stable identifier. All Redis keys (rate limiter, page cache) and
  the Elasticsearch document id key off the numeric `CrawlSource.id`.
- **Storage**: Elasticsearch now, not a throwaway Postgres table — `CrawlerResult` docs, no
  AI-enrichment fields yet, upserted by a deterministic id = `${sourceId}:${externalId}` so
  re-crawls update `lastSeenAt` instead of duplicating. This composite key is the unique identity
  of a vacancy across the whole space.
- **Multi-user keyword filtering happens at read time**, not crawl time: crawling stores
  everything found on the (1-2) listing pages regardless of which crawler job triggered it;
  keywords from `CrawlerJob.keywords` are applied as an ES query when building that job's
  vacancy view.
- **Staleness**: one global env var `MAX_VACANCY_AGE_DAYS` (default 14), applied only as a
  read-time ES filter (`lastSeenAt >= now - N days`). No cron/cleanup job, no per-user or
  per-crawler-job override, no admin UI/settings table this increment.
- **Page volume bound**: new `CrawlSource` field `maxPagesPerRun` (int, default 1-2). Only the
  listing page(s) are fetched — no per-vacancy detail-page crawl (that's AI-enrichment-era work).
- **No raw-page browser/debug UI** — the page cache is internal infra only; visibility is via
  existing `JobLog` lines (e.g. "fetched habr_career page 1 (cache: miss, 25 vacancies)").
- **Non-habr sources**: still selectable in the Crawler Job UI (unchanged), but the runner logs a
  `WARN` JobLog ("crawling not yet implemented for {source.name}") and skips them gracefully
  rather than failing the whole crawler job.
- **Two read endpoints**, both returning vacancies, different scope:
  - `GET /sources/:sourceId/vacancies` — raw feed for one source, age-filtered only, no
    per-user keyword filter (not scoped to any one crawler job).
  - `GET /crawler-jobs/:id/vacancies` — same underlying data, additionally filtered by that
    crawler job's `keywords` across its selected sources (the personalized view).

## Implementation plan

### 1. Infra
- `docker-compose.yml`: add `redis` (redis:7-alpine, host port e.g. 6380→6379) and
  `elasticsearch` (single-node, security disabled for local dev), following the existing `db`
  service's pattern (named volume, healthcheck).
- `apps/api/.env(.example)`: add `REDIS_URL`, `ELASTICSEARCH_URL`, `MAX_VACANCY_AGE_DAYS`.
- `apps/api/package.json`: add `axios`, `cheerio`, `ioredis`, `@elastic/elasticsearch`.
  (`puppeteer` intentionally **not** added — see spike result above.)

### 2. Prisma schema
- `CrawlSource`: add `maxPagesPerRun Int @default(1)`. New migration.
- No new Postgres tables — `CrawlerResult` lives in Elasticsearch only.

### 3. `apps/api/src/crawler/` (new module)
- `types.ts` — `RawVacancy { externalId, title, company, url, postedAt, sourceId }`,
  `CrawlStrategy { crawl(source: CrawlSource): Promise<RawVacancy[]> }`.
- `strategies/axiosCheerioStrategy.ts` — fetch (via the rate-limited/cached fetcher below) up to
  `source.maxPagesPerRun` listing pages, parse with the selectors confirmed above.
- `index.ts` — `getStrategy(source): CrawlStrategy | null`, dispatches by `source.type`,
  effectively resolving to `AxiosCheerioStrategy` for the one implemented source (`habr_career`);
  returns `null` (→ `WARN` + skip) for anything without a real parser yet.
- `rateLimiter.ts` — Redis-backed `waitForSlot(sourceId, delayMs)`: read/set a
  `rate:source:{sourceId}` timestamp key, sleep the remaining delta if needed.
- `pageCache.ts` — `getOrFetch(sourceId, pageUrl, fetchFn)`: Redis key
  `page:raw:{sourceId}:{pageUrl-hash}`, short TTL (a few minutes), returns cached HTML on hit
  (skipping the rate limiter entirely on hit, since no new request happens).
- `redisClient.ts` — single `ioredis` instance from `REDIS_URL`, reused by both files above.

### 4. `apps/api/src/search/` (new module, minimal)
- `esClient.ts` — `@elastic/elasticsearch` client from `ELASTICSEARCH_URL`.
- `crawlerResultsIndex.ts` — index name const (`crawler_results`) + mapping (`sourceId,
  externalId, title, company, url, postedAt, firstSeenAt, lastSeenAt`).
- `upsertVacancy.ts` — `upsert(raw: RawVacancy)`: id = `${sourceId}:${externalId}`,
  `doc_as_upsert` setting `lastSeenAt: now` always, `firstSeenAt` only on insert.
- `queryVacancies.ts` — two query functions, both age-filtered
  (`lastSeenAt >= now - MAX_VACANCY_AGE_DAYS`):
  - `queryVacanciesForSource(sourceId): Promise<CrawlerResultDoc[]>` — unfiltered beyond age.
  - `queryVacanciesForJob(job: CrawlerJob): Promise<CrawlerResultDoc[]>` — same, additionally
    filtered to the job's selected `sourceId`s and (if `job.keywords` present) a simple `match`
    on `title`/`company`.
  This is the only "search" surface this increment — no facets, no Coveo layer yet.

### 5. Real runner — replaces `apps/api/src/crawler-jobs/crawler-jobs.runner.ts`
Keeps the exact same exported signature and race-guard mechanics as today's mock
(`startMockRun(jobId, sources)` / `stopMockRun(jobId)`, status-conditioned `updateMany` calls,
`JobLog` writes) so `crawler-jobs.service.ts`'s two call sites don't need to change shape — only
the mock body is swapped for real logic:
- Per source: `JobLog` "Starting crawl of {name}"; `getStrategy(source)` — if `null`, `JobLog`
  `WARN` + continue to next source; else run `waitForSlot` + `getOrFetch` + strategy parse,
  `JobLog` "fetched page N (cache: hit/miss, M vacancies)", then `upsertVacancy` per item,
  `JobLog` "Found M vacancies for {name}".
- Wrap per-source work in try/catch → `JobLog` `ERROR` + continue to next source (one source
  failing shouldn't fail the whole crawler job) rather than aborting.
- `stopMockRun`-equivalent: same cooperative-cancellation approach (check a "stopped" flag between
  awaits, matching today's timer-clearing behavior as closely as async/await allows).

### 6. New read endpoints
- `GET /sources/:sourceId/vacancies` (new route/controller/service function alongside
  `sources.routes.ts` → `sources.controller.ts` → `sources.service.ts`) — auth-guarded, calls
  `queryVacanciesForSource`.
- `GET /crawler-jobs/:id/vacancies` (same layering as `crawler-jobs.routes.ts` →
  `crawler-jobs.controller.ts` → `crawler-jobs.service.ts`) — auth-guarded like the rest of
  `/crawler-jobs`, calls `queryVacanciesForJob`.
  No UI work this increment (API only, spot-checked via curl/Postman) unless the user wants a
  quick vacancy list added to the crawler job detail page — ask before building UI.

## Verification (manual, per `CLAUDE.md`'s Testing Philosophy)

- `docker compose up -d` — confirm `redis` and `elasticsearch` containers healthy alongside
  existing `db`.
- `npx prisma migrate dev` for the new `maxPagesPerRun` column; re-run seed.
- Create a Crawler Job selecting `habr_career`, `POST /crawler-jobs/:id/start`, watch `JobLog`
  entries (via the Crawler Jobs UI or `GET /crawler-jobs/:id`) show real fetch/parse progress
  instead of fake timer messages, confirm `status` reaches `COMPLETED`.
- `GET /crawler-jobs/:id/vacancies` returns real vacancy titles/companies/urls from
  `career.habr.com`; `GET /sources/:sourceId/vacancies` (habr_career's id) returns the same
  underlying vacancies unfiltered by keywords.
- Start two crawler jobs against `habr_career` back-to-back within the cache TTL — confirm via
  `JobLog` that the second shows a cache **hit** (no duplicate outbound request), and confirm ES
  has no duplicate documents (same `sourceId:externalId` re-upserted, `lastSeenAt` bumped).
- Create a crawler job for a non-implemented source (e.g. RemoteOK) — confirm it logs the `WARN`
  and still reaches `COMPLETED` rather than `FAILED`.

## Implementation steps

- [x] Add `redis`/`elasticsearch` to `docker-compose.yml`; add env vars; add npm dependencies.
- [x] Add `CrawlSource.maxPagesPerRun` migration.
- [x] Build `apps/api/src/crawler/` (strategy interface, Axios/Cheerio strategy, rate limiter,
      page cache, Redis client).
- [x] Build `apps/api/src/search/` (ES client, index mapping, upsert, query functions).
- [x] Replace the mock runner with the real one; keep the signature/race-guards unchanged.
- [x] Add the two vacancy read endpoints.
- [x] Manual verification per the checklist above.
