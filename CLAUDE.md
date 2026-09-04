# CLAUDE.md - Job-Crawler-Demo

## Project Overview

**Project Name:** Job-Crawler-Demo  
**Description:** A modular demonstration web application showcasing a modern web crawling and data processing stack, inspired by enterprise data crawling systems (e.g. SAP-style).

**Goal:**  
Create a clean, well-structured MVP that demonstrates the full tech stack: TypeScript + Node.js crawling framework with Puppeteer, Elasticsearch, Redis, AI enrichment, and user personalization.

## Tech Stack

### Backend (`apps/api`)

- **TypeScript + Node.js + Express** — Core backend and REST API
- **Puppeteer** — Crawling JavaScript-rendered pages (chosen per source, via `CrawlSource.type`)
- **Axios + Cheerio** — Fast static page crawling
- **PostgreSQL** — Store users, crawl runs, crawl logs, settings
- **Redis** — Rate limiting, simple crawl run state, caching
- **Elasticsearch** — Main storage and search engine for crawled results
- **Coveo-like layer** — Light abstraction above Elasticsearch that mimics a Coveo-style
  search experience (facets, relevance sorting). Saved searches are **out of scope for MVP**.
- **JWT Authentication** — User registration and login. Crawling and search are shared/global,
  not owned per user — see Security Considerations.
- **Claude API** — AI enrichment (summarization, skill extraction, categorization).
  Start with a `MockAIEnricher`; wire the real API (key in `.env`) in a later stage.
- **Winston** — Structured logging

### Frontend (`apps/web`)

- **Next.js + React** — a crawler management console **SPA** (Single-Page Application: the page
  loads once, then navigation/updates happen in the browser via JavaScript instead of a full page
  reload per click), organized with **Feature-Sliced Design (FSD)** — a way of arranging frontend
  code into layers by *what a piece of code is for* (e.g. a reusable button vs. a page-specific
  feature vs. a whole page's widget), so that code for one concern doesn't get tangled with code
  for another. The exact layers are listed below in "Architecture methodologies".
  The FSD layer skeleton and the auth building blocks (login/register pages, the
  `entities/session` slice, the `useRequireAuth` hook, the `shared/lib/api.ts` HTTP client, the
  `shared/ui` component folder) were carried over from an earlier starting point rather than
  built from scratch. Everything else — what the app does, its pages/features/entities, and the
  backend it talks to — is specific to this project: it calls **our own Express API**.
- **shadcn/ui** — not an installed npm component library; it's a CLI (configured in
  `apps/web/components.json`) that generates a component's source code (e.g. `button.tsx`,
  `card.tsx`) and writes it directly into `apps/web/shared/ui/`. Those files become ordinary
  project source — owned and freely editable — not files pulled from `node_modules`. The
  `"ui": "@/shared/ui"` alias in `components.json` is what tells the CLI which folder to write
  generated components into.

### Infrastructure

- **Docker + Docker Compose** — Local environment (Postgres, Redis, Elasticsearch)

## Data Sources

Given the original 2-week timeline, the plan was to do **one source well rather than three done
thinly**. In practice, the crawler abstraction built for the first source (`habr_career`)
generalized cleanly to a second, structurally different source (`remoteok`, Increment 4) without
any changes to `crawlRunner.ts` or the `CrawlStrategy` interface — see
`04_FEATURE_PUPPETEER_REMOTEOK.md` — so two sources are implemented today. `weworkremotely` and
`craigslist` remain deferred: they're seeded as selectable `CrawlSource` rows, but have no parser
yet (see below).

| Key              | Site                     | Status          | Type (`CrawlSource.type`)                                     | Notes                                                        |
| ---------------- | ------------------------ | --------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| `habr_career`    | career.habr.com          | **Implemented** (Increment 1–2.2) | `STATIC` — confirmed fully server-rendered (both the listing and, per Increment 2.2, the vacancy detail pages); crawled with Axios+Cheerio, no Puppeteer needed | RU tech jobs; good fit for AI skill-extraction demo |
| `remoteok`       | remoteok.com             | **Implemented** (Increment 4) | `DYNAMIC` — confirmed the site returns `403` on a plain non-browser request (Cloudflare bot check); crawled with Puppeteer (a real desktop-Chrome UA, not a bot-identifying string) to get past the wall | Tech jobs with ready-made skill tags; listing page alone carries everything needed (description, tags) via per-row JSON-LD, so no detail-page crawl. `baseSalary`/location in that JSON-LD are boilerplate placeholders (identical across every row), not real per-employer data — not stored, same reasoning as habr's dropped salary field; replaces `moikrug` |
| `weworkremotely` | weworkremotely.com       | Deferred, no parser yet | `STATIC` — `robots.txt` is `Allow: /` aside from account/admin paths; listings confirmed server-rendered on a manual check | Simple, long-established scraper-friendly job board |
| `craigslist`     | craigslist.org (SW jobs) | Deferred, no parser yet | `STATIC` — listings are server-rendered and accessible without login on a single request, but craigslist has a documented history of legal/technical enforcement against scrapers (e.g. the 3taps/PadMapper case); expect rate-limiting or CAPTCHA under sustained automated access even though a one-off check looks simple | International example, multiple cities |

`moikrug` is gone as a distinct source — `moikrug.ru` now permanently redirects (301, both
`robots.txt` and the site itself) to `career.habr.com`; Habr absorbed it. Replaced by `remoteok`
and `weworkremotely` above.

`weworkremotely` and `craigslist` are deferred — add them later as additional `CrawlStrategy`
adapters if time allows, without changing the crawler architecture.

All four are already seeded as `CrawlSource` rows (`apps/api/prisma/seed.ts`) so they're
selectable on the Sources page. `habr_career` and `remoteok` have real `CrawlStrategy`
implementations (`habrCareerStrategy.ts` — Axios+Cheerio, listing crawl plus per-vacancy detail
crawl; `remoteOkStrategy.ts` — Puppeteer, listing crawl only — see the "Real crawler...", "Vacancy
detail crawl...", and "Puppeteer RemoteOK..." features in `.claude/features/`); `weworkremotely`
and `craigslist` don't have a parser yet, so triggering a crawl for them (or using "crawl all")
logs a `WARN` and skips them rather than failing the run. Strategy files are named after the site
they crawl (`<siteKeyCamelCase>Strategy.ts`), not the library used to fetch/parse it — the
fetch/parse technology (Axios+Cheerio vs. Puppeteer) is an implementation detail internal to each
file. Dispatch (`getStrategy` in `apps/api/src/crawler/index.ts`) is by `CrawlSource.name`, not by
`CrawlSource.type` — `type` only signals "needs a browser or not," it doesn't imply every source
of the same type can share one strategy's selectors/navigation. Crawling is triggered directly per
source via `POST /sources/:id/crawl` — see `.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md`
— there is no separate job entity that picks which sources to run.

For each source we define: `type` (`STATIC`/`DYNAMIC` — determines Axios+Cheerio vs Puppeteer),
`defaultDelayMs`, base URL, and (eventually) the CSS selectors/fields to parse. This all lives on
the `CrawlSource` itself; there's no separate per-run configuration. Always respect the site's
`robots.txt` and apply rate limiting.

## Coding Standards

- Strict TypeScript usage (interfaces/types instead of `any`)
- Clean, modular, and extensible architecture
- Proper error handling and logging
- Async/await everywhere
- ESLint + Prettier
- Clear comments for complex logic

### Architecture methodologies (important — two different worlds)

- **Frontend (`apps/web`)** follows **Feature-Sliced Design (FSD)**: layers
  `app → widgets → features → entities → shared`. Import rule: a layer may only import
  from layers below it, never sideways or upward; cross-slice imports go through a slice's
  `index.ts` public API (no deep imports).
- **Backend (`apps/api`)** follows a **layered / modular** structure
  (`controllers → services → crawler/ai/search/auth → models`). This is NOT FSD — do not mix
  the two vocabularies.

## Git & Development Workflow

- Use meaningful commit messages in English; work in feature branches; keep `main` stable;
  commit often, push regularly. All code in English.
- Full commit/PR conventions (who drafts the PR description, review checklist requirements, the
  no-auto-merge rule) are in the `git-workflow` skill (`.claude/skills/git-workflow/SKILL.md`) —
  Claude Code loads it automatically when committing or opening a PR.

### Feature design docs (`.claude/features/`)

Every non-trivial feature or increment gets a design doc in `.claude/features/`, written (or
updated) as part of that work — not after; it's the durable record of **why** behind the code.
Naming convention, required contents, and sync rules are in the `feature-design-docs` skill
(`.claude/skills/feature-design-docs/SKILL.md`) — Claude Code loads it when starting or updating
a feature doc.

## User Stories (MVP)

As a user I can:

1. Register and log in (JWT Authentication)
2. View a list of predefined data sources (see Data Sources above)
3. Start / Stop a crawl for a source, or crawl all sources at once — crawling is a shared,
   global operation (not scoped to me); any logged-in user can trigger it (see Security
   Considerations). Crawl strategy, delay, and page depth are not configurable per run — they
   come from the selected `CrawlSource`'s own `type`/`defaultDelayMs`/`maxPagesToCrawl`.
4. See the status and progress of a source's crawl runs, including execution logs
5. Search through all collected vacancies using Elasticsearch — free text plus facets
   (Specialization, Seniority level, Remote/On-site, Location, Company) and relevance sorting
6. Receive AI-enriched summaries of crawled content (future increment)

## Data Models (summary)

Full field definitions live in `ARCHITECTURE.md`. Core entities:

- **User** — PostgreSQL. Authentication only — see Security Considerations for why crawling and
  search have no per-user ownership.
- **CrawlSource** — PostgreSQL. A seeded, shared crawl target (name/baseUrl/type/rate-limit
  config). Crawling is triggered directly on a source, not via a separate job entity.
- **CrawlRun** — PostgreSQL. One crawl execution of one source: status, timestamps, vacancy
  count. Owns `CrawlLog[]`.
- **CrawlerResult** — Elasticsearch (primary). A crawled + AI-enriched vacancy, deduplicated by
  `sourceId:externalId` across the whole shared corpus.
- **CrawlLog** — PostgreSQL. Execution log lines per `CrawlRun`.

## Elasticsearch conventions

- **Elasticsearch is a derived search index, not the source of truth.** The `crawler_results`
  index is a rebuildable projection of crawled data — every vacancy is re-fetchable by re-crawling
  (`upsertVacancy` is idempotent by `sourceId:externalId`). PostgreSQL holds the authoritative
  records (users, sources, crawl runs/logs).
- **Search-index schema changes are handled through index versioning, not in-place migration.**
  `crawlerResultsIndex.ts` exports `CRAWLER_RESULTS_SCHEMA_VERSION`, stamped into the index
  mapping's `_meta`. `ensureCrawlerResultsIndex` compares the live index's stored version and, on a
  mismatch, deletes + recreates the index empty and lets the next crawl repopulate it. Bump the
  constant whenever the mapping changes in a way existing docs won't satisfy (new field, changed
  sub-field, changed type). Zero-downtime alias migration is deliberately out of scope for this MVP.
- **Rebuilding the search index does not affect crawl history or primary data.** A version-mismatch
  rebuild touches only the ES index; `CrawlRun`/`CrawlLog` and all other Postgres records are left
  untouched. (The admin "Clear search data" action is the separate, heavier operation that also
  wipes `CrawlRun` history — see `.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md`.)

## Technical Guidelines & Axioms

- All code, documentation, comments, variable names, function names, folder names, and UI text must be in **English**.
- The entire project interface and user-facing content should be in English.
- Russian can only be used in personal development notes (`.notes/`, git-ignored), and in
  `.claude/doc/` — a deliberate, tracked exception: that directory holds Sergei's personal
  learning/presentation write-ups of the tech stack, not project or user-facing documentation.
  See `.claude/doc/CLAUDE.md` for the conventions governing that directory.
- Crawling is global, not scoped to a user — see Security Considerations.
- Respect `robots.txt` and implement rate limiting (via Redis).
- Puppeteer vs Axios/Cheerio is chosen per source (`CrawlSource.type`), never a per-run setting.
- AI enrichment goes through an interface; ship a `MockAIEnricher` first, real Claude API later.
- Keep the architecture modular and easy to extend.
- Prefer simplicity for MVP (avoid over-engineering).
- Whenever a step changes, adds to, or invalidates something described in `CLAUDE.md`,
  `README.md`, or `ARCHITECTURE.md`, update the affected file(s) as part of that step —
  don't let the docs drift out of sync with the code.

## Security Considerations

- **Crawling is a shared, global operation, not owned per user.** Sources are shared seed data,
  and the corpus they produce in Elasticsearch is a single deduplicated collection
  (`sourceId:externalId`) — mirroring how ingestion/admin operations work against shared
  infrastructure in real search systems (Coveo, Elastic connectors). Any authenticated user can
  start/stop a crawl run for any source and see its status/logs; there is no per-user ownership
  check to bypass, because there is no owner. The per-source Redis rate limiter is what protects
  the source from abuse (repeated/overlapping crawl requests), not per-user gating.
- **No RBAC yet.** A production deployment would gate crawl-triggering behind an admin role; this
  MVP deliberately treats every logged-in user as trusted to trigger crawls — see
  `.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md` for why this was deferred rather than
  built now.
- **Search is read-only and unscoped** — the search endpoint returns matches from the whole
  shared corpus; there's nothing to authorize per-result since nothing is owned per user.
- Client-side restrictions (disabled buttons while a crawl is `RUNNING`) are UX only —
  server-side, status-conditioned writes (the concurrency guard preventing two overlapping runs
  of the same source) are authoritative and re-checked on every request.

## Product UI Principles

This application is a crawler management console.

Prioritize:
- clarity of workflows over visual decoration
- showing crawl status and progress
- clear distinction between configuration (Sources) and results (Search)
- operational information visibility

Main user actions should be obvious:
- run a crawl (per source, or all sources)
- inspect a source's crawl status and logs
- search and filter results (facets)
- review history

## UI Design Guidelines

Reference screenshots live in `.claude/.design-samples/` (git-ignored, local-only). Use those
samples as the default visual language; introduce new patterns only when the workflow requires
them. The full set of layout/typography/color/component conventions (cards, design tokens,
typography hierarchy, button color hierarchy, links, dashes, log coloring, destructive-action
styling) is in the `ui-design-guidelines` skill (`.claude/skills/ui-design-guidelines/SKILL.md`)
— Claude Code loads it automatically when writing or editing `apps/web` UI code.

## Testing Philosophy

- Primary testing method: **manual testing** through the browser; automated tests (if any) are
  added later for critical paths and regression.
- Full testing goals, the "before marking Done" checklist requirement, and the browser-automation
  policy are in the `testing-philosophy` skill (`.claude/skills/testing-philosophy/SKILL.md`).

## Project Structure (Target)

Monorepo with two apps:

```
/apps
  /api                 # Express backend
    /src
      /config
      /controllers
      /services
      /crawler         # crawler framework (Puppeteer + Axios/Cheerio strategies)
      /ai              # AIEnricher interface, MockAIEnricher, ClaudeEnricher
      /search          # Coveo-like layer over Elasticsearch
      /auth            # JWT auth
      /models          # Postgres models / repositories
      /routes
      /utils
      /workers         # crawl runner / queue consumers
      /types
  /web                 # Next.js frontend (FSD)
    /app               # routing only
    /widgets           # about, sources, source-detail, search, sidebar
    /features          # auth, run-crawl, search-vacancies
    /entities          # session, user, source, vacancy
    /shared            # ui/, lib/ (api client)
/docker                # docker-compose + service configs
```
