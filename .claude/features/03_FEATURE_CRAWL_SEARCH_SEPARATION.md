# FEATURE: Separate Crawling from Search (Increment 3)

## Overview

Restructures the app's information architecture to stop conflating two different concerns that
the current `CrawlerJob` entity smears together, and adds the Coveo-like faceted search that MVP
user story #6 calls for.

**The problem.** Today a `CrawlerJob` bundles:
1. **crawl execution** — which sources to run, run status, `JobLog` progress; and
2. **search/filter** — `keywords` plus a view of the resulting vacancies.

But `keywords` is a **read-time Elasticsearch filter**, not a crawl parameter — Increment 2 locked
in that crawling stores *everything* it finds regardless of keywords, and keywords only filter at
read time (`queryVacanciesForJob`). So `CrawlerJob` is doing two unrelated jobs, and the UI page
mixes "configure a crawl" with "search results".

**The fix.** Split along the industry-standard line between **content ingestion (an operator/admin
concern)** and **the search experience (an end-user concern)**:
- Crawling becomes an action on a **Source** (which already owns everything crawl-related:
  `CrawlStrategy`, rate limiter, page cache, `defaultDelayMs`, `maxPagesPerRun`). The crawled
  corpus in Elasticsearch is shared, single, and deduplicated (`sourceId:externalId`) — nobody
  crawls their own private copy.
- Search becomes its own page over that shared corpus, with facets + free-text + relevance.

This is a large change, so it's split into two increments sharing this one doc:
- **Phase 3a** — the refactor: crawling moves onto Sources (`CrawlerJob` → `CrawlRun`), no new
  search capability yet.
- **Phase 3b** — the new Search page with facets, built on the corpus 3a leaves in place.

## Status

**Phase 3a: Implemented and manually verified** (docs, backend, frontend all landed on branch
`feat/crawl-search-separation-3a`). **Phase 3b (Search page with facets): Implemented, backend
verified end-to-end (2026-07-31); frontend awaiting the user's manual browser pass per `CLAUDE.md`
Testing Philosophy — see the Verification checklist below for what's confirmed vs. still open.**

## Target information architecture

Sidebar goes from `Dashboard / Sources / Crawler Jobs / Profile` to:

| Nav item | Was | What it is now |
| --- | --- | --- |
| **About** | "Dashboard" (already just an About card) | Rename only — the page is already an About card; the "Dashboard" label was misleading. |
| **Sources** | Sources (read-only list) | Now also where you **run crawls**: per-source Start/Restart/Stop, run status, collapsible logs, and the source's crawled vacancies. |
| **Search** | "Crawler Jobs" (removed) | New: faceted, full-text search across the whole crawled corpus (Phase 3b). |
| **Profile** | Profile | Unchanged. |

## Decisions locked with the user (do not re-litigate)

- **Crawling is global, not per-user (Variant A).** Sources are shared, seeded, global rows; a
  crawl is an operation on shared infrastructure, so crawl actions/run-state/logs are **not**
  per-user. Any logged-in user can trigger a crawl and see any crawl's status/logs. This matches
  the standard "ingestion is an admin/operator concern, the corpus is shared" model. It **does**
  change the current per-user ownership model — `CLAUDE.md`'s Security Considerations section
  (currently all about per-user `CrawlerJob` ownership) must be rewritten to reflect that crawling
  is a shared operation guarded only by login + the per-source rate limiter (worst case of "any
  user can crawl" is redundant work, not abuse, because the rate limiter protects the source).
- **A real admin/user role split (RBAC) is deferred** to a possible future increment. For now the
  doc/UI note where the admin boundary *would* go, but everyone logged in can crawl. This keeps the
  refactor focused instead of ballooning into an auth/roles project.
- **`CrawlerJob` → `CrawlRun`.** The `CrawlerJob` entity (and its whole module + edit/delete/
  create UI) is removed. Crawl run-state and logs re-home onto Sources via a lightweight
  `CrawlRun` record (see Data model). The "select several sources + keywords + view results"
  bundle is dissolved: source selection is implicit (you crawl a specific source), keywords move
  to the Search page.
- **No Source CRUD (create/edit/delete) from the UI this increment.** Crawlability lives in
  **code** (a bespoke `CrawlStrategy` per site — selectors, JSON-LD parsing — dispatched by
  `getStrategy`), not in the `CrawlSource` row. A UI-created source could not be crawled without
  shipping a parser, so "Create source" would be a misleading capability (this is the config-vs-code
  distinction: real platforms like Coveo let admins create sources because they configure a
  *generic pre-built connector*; we have per-site parsers instead). Sources stay configured/seeded.
  A scoped edit of just the operational knobs (`defaultDelayMs`, `maxPagesPerRun`) is plausible but
  deliberately deferred to keep this increment focused; `name`/`type`/`baseUrl` must never be
  UI-editable since `getStrategy` dispatches on them.
- **Facet set (Phase 3b)**: primary facets **Specialization**, **Seniority level**, and
  **Remote / On-site**; second-tier facets **Location** and **Company**. All derive from data we
  already crawl — no new crawling needed (see Phase 3b for extraction details). Splitting
  `skillsSummary` into a normalized skill array is **still out of scope** (that's interpretation →
  AI Enrichment, not template parsing).
- **"Search", not "Searches".** A single stateless search page (query + facets, no persistence).
  Saved searches remain out of MVP scope per `CLAUDE.md`.

## Data model changes

Postgres (`apps/api/prisma/schema.prisma`), a migration:
- **Remove** `CrawlerJob` model (and `User.jobs` relation).
- **Add `CrawlRun`**: `id`, `sourceId` (FK → `CrawlSource`, `onDelete: Cascade`), `status`
  (reuse the existing status enum, renamed `JobStatus` → `CrawlStatus`), `startedAt`,
  `finishedAt DateTime?`, and a small stats field (`vacanciesFound Int @default(0)`). Owns
  `CrawlLog[]`.
- **`JobLog` → `CrawlLog`**: same shape (`level`, `message`, `createdAt`), but FK re-homed from
  `jobId` (CrawlerJob) to `runId` (CrawlRun). Keep the `LogLevel` enum as-is.
- **Concurrency invariant**: at most one non-finished (`RUNNING`) `CrawlRun` per `sourceId`. Guard
  at start the same way `startJob` already does — a status-conditioned write + the in-process
  cancellation `Map` (see runner) — just keyed by `sourceId` instead of `jobId`.
- **History vs. latest**: `CrawlRun` rows accumulate as a history, but the Sources UI this
  increment only surfaces the **latest run per source** (status + logs). A full run-history list is
  out of scope for now (the table supports it later without another migration).

Elasticsearch — no change in Phase 3a. Phase 3b adds fields/mappings (see below).

## Phase 3a — Refactor: crawling moves to Sources

### Backend
- **Runner** (`crawler-jobs.runner.ts` → e.g. `crawler/crawlRunner.ts`): change signature from
  `startCrawlerRun(jobId, sources[])` / `stopCrawlerRun(jobId)` to per-source
  `startCrawlerRun(sourceId)` / `stopCrawlerRun(sourceId)`. Reuse the existing internals almost
  verbatim — the per-source `crawlSource(...)` loop body, `getStrategy`, `enrichDetails`,
  `upsertVacancy`, the `RunState { cancelled }` `Map`, and the status-conditioned `updateMany`
  guard all carry over; they just key on the run/source and write `CrawlLog` (by `runId`) instead
  of `JobLog` (by `jobId`). Crawling one source = one `CrawlRun`.
- **Routes/controllers/services**: remove the `crawler-jobs` module. Add to the **sources** module:
  - `POST /sources/:id/crawl` (start) and `POST /sources/:id/crawl/stop` — auth-guarded, global
    (no ownership check; just `requireAuth`).
  - `GET /sources/:id/run` — latest `CrawlRun` for the source, including its `CrawlLog[]` (feeds
    the status + collapsible logs UI). Reuse the `logInfo`/`logWarn`/`logError` helpers and the
    fire-and-forget `.catch(...)` pattern from the current `startJob`.
  - Keep the existing `GET /sources/:id/vacancies` (already backed by `queryVacanciesForSource`).
- **A "crawl all sources" action**: a `POST /sources/crawl-all` convenience that starts a run per
  crawlable source (skipping ones whose `getStrategy` returns `null`, logging a WARN as today).

### Frontend (FSD)
- **Sidebar** (`widgets/sidebar/ui/sidebar.tsx`): nav becomes `About / Sources / Search / Profile`
  (`/dashboard` route+page can stay but relabel to "About", or rename the route to `/about`).
- **Remove** the `widgets/crawler-jobs`, `widgets/crawler-job-detail` widgets and the
  `features/create-crawler-job`, `features/edit-crawler-job`, `features/delete-crawler-job`,
  `features/run-crawler-job` slices, plus the `entities/crawler-job` slice. Salvage/move the pieces
  worth keeping (below) before deleting.
- **Sources page** (`widgets/sources/ui/sources-page.tsx`): each source row gets Start/Restart/Stop
  (reuse the `Button` secondary-variant + `StatusBadge` + `w-20` fixed-width patterns from the old
  crawler-jobs list) and a "run all" action.
- **Source detail page** (new, `/sources/:id`): the crawl status + Start/Stop, a collapsible
  **Execution logs** panel (reuse the `CrawlLog`-level → color convention: `ERROR` →
  `text-destructive`, per `CLAUDE.md`), and the **Vacancies** list — moved wholesale from the old
  crawler-job detail page, including the per-vacancy fields (Remote badge, location, skills summary,
  description preview) and the **"View raw ES data"** toggle, all of which already exist and just
  need re-homing.
- Reuse the existing RUNNING-state polling pattern (`POLL_INTERVAL_MS`) for live status/logs.

### Docs (part of the 3a PR)
- `CLAUDE.md`: rewrite **User Stories #3-#7** (no more "Crawler Job"; crawling is per-source and
  global; searching is its own story), and rewrite **Security Considerations** (crawling is a
  shared operation guarded by login + rate limiter, not per-user ownership; note where an admin
  role boundary would go).
- `ARCHITECTURE.md`: replace the `CrawlerJob`/`JobLog` model definitions with `CrawlRun`/`CrawlLog`;
  update the layering/routes description.
- `README.md`: update the "implemented so far" sections and the "Checking crawled data" endpoints.

## Phase 3b — Search page with facets

### Decisions locked with the user (2026-07-31, before implementation)

- **Layout: two-column, not the app's usual single-column `max-w-3xl`.** Every other page
  (Sources, Source detail, About, login) uses one left-aligned column per `CLAUDE.md`'s UI
  guidelines. Search is the first page where that doesn't fit — a facet panel needs to sit
  alongside results, not stack above them (stacking was considered and rejected: with 3 facets
  stacked over results, the page consumes most of the fold before reaching a single vacancy).
  **Chosen**: a wider container (`max-w-5xl`/`6xl`, TBD to taste once built), a fixed-width facet
  `Card` on the left (`Specialization` / `Seniority level` / `Remote / On-site`), results list on
  the right. This is a deliberate, scoped exception to the single-column rule, not a precedent for
  every future page — `CLAUDE.md`'s UI guidelines get a short note recording it as such.
- **Remote/On-site facet: two checkboxes, not one toggle.** `☐ Remote (N)` and `☐ On-site (N)`,
  consistent with how every other facet renders (a checkbox group with per-bucket counts) rather
  than a special-cased single boolean control. Both selected (or neither) means no `isRemote`
  filter is applied.
- **Pagination: server-side `from`/`size` returning a real `total`** (revised 2026-08-07 during
  code review — supersedes the original "fetch `size: 200` and paginate client-side" plan). The
  original plan capped hits at 200 while the facet aggregations counted the *whole* filtered match
  set, so a facet bucket could read a count larger than the number of results a user could actually
  page through — an inconsistency, and a silent truncation once the corpus passes 200. **Chosen**:
  `searchVacancies` takes `page`/`pageSize` (default 10, clamped to ≤ 50), issues one ES request
  with `from`/`size` + `track_total_hits: true`, and returns `{ hits, total, facets }`. The
  frontend's existing Previous/Next + "Page X of N" control now drives the server page instead of
  slicing a client-side array; facet counts and the paged result set are computed from the same
  filtered set, so they stay consistent. `from + size` stays well under ES's default
  `index.max_result_window` (10 000) at `pageSize ≤ 50` — fine for this corpus; a cursor
  (`search_after`) approach was considered and rejected as overkill (it breaks random page-jump and
  isn't needed at this scale).
- **Vacancy card becomes a shared component**, not duplicated: extract the card currently inline
  in `source-detail-page.tsx` (title/link, Remote badge, company, location, postedAt,
  skillsSummary, description preview, "View raw ES data" toggle) into `entities/vacancy/ui/`, and
  have both the Source detail page and the new Search page render it. Per FSD, `entities/vacancy`
  is the right home (both a widget and the search feature depend on it, never the reverse).
- **New backend route lives in its own `apps/api/src/vacancies/` module** (`vacancies.routes.ts`
  mounted at `/vacancies`, `vacancies.controller.ts`, `vacancies.service.ts` wrapping the new
  `search/` query builder) — mirrors the existing `sources`/`admin`/`users` module shape rather
  than bolting a controller onto `search/`, which stays query/ES-plumbing only (no Express layer),
  consistent with the rest of the codebase's `controllers → services → crawler/ai/search/auth`
  layering from `CLAUDE.md`.

### Facet data extraction (backend, no new crawling)
- Extend `parseHabrVacancyDetail` to also pull, from the same stable habr template sentence already
  parsed for `skillsSummary` (`"Навыки: … Квалификация: <Seniority>. Специализации: <Specialization>."`):
  - `specialization` — text after `Специализации:` (e.g. "Фронтенд разработчик"); may be absent → `null`.
  - `seniority` — text after `Квалификация:` (Junior/Middle/Senior); often absent → `null`.
  This is still template parsing (crawling), not interpretation. Add both to `RawVacancy`,
  `CrawlerResultDoc`, and the upsert (same conditional-spread pattern already in `upsertVacancy`).
- **ES mapping** (`crawlerResultsIndex.ts`): add `specialization` and `seniority` as `keyword`; give
  `location` and `company` a `.keyword` sub-field (`{ type: "text", fields: { keyword: { type:
  "keyword" } } }`) so they're both full-text-searchable and aggregatable. `isRemote` is already
  `boolean` (aggregatable as-is).
- **Reindex strategy: index-version detection + rebuild-and-repopulate** (revised 2026-08-07 during
  code review — supersedes the earlier `putMapping` "additive reconcile" path). The problem the
  review surfaced: `putMapping` reconciles the *mapping* but does not backfill already-indexed docs,
  so adding the `company.keyword`/`location.keyword` sub-fields left every pre-existing vacancy
  invisible to the Location/Company facets and filters until re-crawled — and the old code comment
  overstated this as "reconciles a pre-existing index with the current schema." **Chosen approach**
  (decided with the user):
  - Elasticsearch is treated as a **derived cache, not the source of truth** — every vacancy is
    re-fetchable by re-crawling (`upsertVacancy` is idempotent by `sourceId:externalId`).
  - `crawlerResultsIndex.ts` exports `CRAWLER_RESULTS_SCHEMA_VERSION` (now `2`), stamped into the
    index mapping's `_meta` on creation. `ensureCrawlerResultsIndex` reads the live index's stored
    version and, on a mismatch (including an unversioned pre-existing index → `null`), **deletes and
    recreates the index empty**, logs a clear WARN/INFO, and lets the normal crawl process
    repopulate it. Bump the constant on any mapping change that existing docs won't satisfy.
  - The rebuild touches **only the ES index** — crawl history (`CrawlRun`/`CrawlLog`) and all other
    Postgres records are left untouched. This is distinct from the admin "Clear search data" action,
    which also wipes `CrawlRun` history.
  - **Zero-downtime alias migration (reindex-into-new-index + alias swap) is explicitly out of scope
    at this stage** — unnecessary for a single dev/demo instance over re-fetchable data.

### Search endpoint
- New `GET /vacancies/search` (global — not per-source, not per-job), query params: `q` (free
  text), and selected facet values `specialization` / `seniority` / `isRemote` / `location` /
  `company`. Builds one ES request that returns both **hits** and **facet buckets**:
  - `bool` query: age filter + `term`/`terms` filters for each selected facet + a `multi_match` on
    `q` over `title`/`company`/`description` (reuse the existing OR-based `multi_match`; keep the
    "matches any word" semantics and the UI hint).
  - `terms` **aggregations** for each facet field (+ isRemote), returning bucket counts for the
    facet UI.
  - *Known simplification to note in the PR*: proper faceted navigation computes each facet's counts
    excluding its own active selection (ES `post_filter` / per-facet filtered aggs). MVP does the
    simpler shared-filter version; flag it as a deliberate simplification, not a bug.
- Put this in a small **search module** (or extend `apps/api/src/search/`) — this is the first real
  piece of the "Coveo-like layer over Elasticsearch" that `CLAUDE.md`/`ARCHITECTURE.md` describe.

### Search page (frontend)
- New `widgets/search` + `/search` route + a `features/search-vacancies` slice + `entities/vacancy`
  (the `Vacancy` type salvaged from the removed `entities/crawler-job`). Layout: a free-text input,
  a facet sidebar/panel (checkbox groups per facet, each showing bucket counts), and the results
  list (reuse the exact vacancy card from the Source detail page — same component). Selecting a
  facet or typing re-queries and re-renders both results and facet counts.

## Out of scope (all increments)

- Saved searches (persisted per user) — explicitly out of MVP per `CLAUDE.md`.
- Admin/user RBAC — deferred; everyone logged in can crawl for now.
- Source create/delete, and even the scoped `defaultDelayMs`/`maxPagesPerRun` edit.
- Splitting `skillsSummary` into a normalized skill array; semantic/fuzzy keyword↔skill matching —
  both are AI Enrichment.
- Puppeteer sources (RemoteOK etc.) — still post-MVP.

## Verification

**Phase 3a** (manual, per `CLAUDE.md` Testing Philosophy):
- Sidebar reads `About / Sources / Search / Profile`; About page unchanged in content.
- On Sources, Start a crawl of Habr Career; confirm status transitions and that the collapsible
  logs show the same real fetch/enrich progress as before, now attached to the source's `CrawlRun`.
- Confirm two rapid Start clicks don't launch two concurrent runs of the same source (status guard).
- Source detail page shows the crawled vacancies (with Remote/location/skills/description + "View
  raw ES data"), i.e. nothing regressed from the old crawler-job detail view.
- Confirm the old `/crawler-jobs` routes and UI are gone and nothing links to them.

**Phase 3b**:
- [x] After a fresh crawl, `GET /vacancies/search` returns hits + non-empty facet buckets for
      specialization/seniority/remote/location/company. Verified directly (2026-07-31): triggered
      a real `habr_career` crawl against a scratch API instance, confirmed newly-enriched
      vacancies carried `specialization`/`seniority`, and that `location`/`company` `.keyword`
      aggregations populated (buckets were empty for older, not-yet-re-crawled docs, as the design
      doc predicted). Also caught and fixed a real bug this way: the `isRemote` boolean facet
      initially returned raw ES bucket keys (`"0"`/`"1"`) instead of `key_as_string`
      (`"true"`/`"false"`) — fixed in `queryVacancies.ts`'s `bucketsFor`.
- [x] A vacancy whose template had no `Квалификация` clause has `seniority: null` and simply
      doesn't appear under any seniority bucket (no crash, no empty-string bucket). Confirmed live
      — "Системный администратор (импортозамещение, Ред Софт)" enriched with
      `seniority: null`/`specialization` populated, no error, no stray bucket.
- [ ] Selecting a facet value narrows the results; typing in the free-text box narrows via
      `multi_match`; combining facets + text works. **Not yet verified — browser testing is the
      user's manual pass per `CLAUDE.md` Testing Philosophy, not automated by Claude.**
- [ ] Two-column Search page layout, checkbox facet groups with bucket counts, and the shared
      `VacancyCard` rendering correctly — same manual browser pass.
