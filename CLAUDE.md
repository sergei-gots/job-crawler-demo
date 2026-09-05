# CLAUDE.md - Job-Crawler-Demo

## Project Overview

**Project Name:** Job-Crawler-Demo — a demonstration crawler management console, inspired by
enterprise data crawling systems (e.g. SAP-style). See [`README.md`](README.md) for the full
pitch and tech-stack summary.

**Goal:** a clean, well-structured MVP demonstrating the full stack: TypeScript + Node.js crawling
with Puppeteer, Elasticsearch, Redis, AI enrichment, and user personalization.

## Tech Stack

### Backend (`apps/api`)

- **TypeScript + Node.js + Express** — Core backend and REST API
- **Puppeteer** — Crawling JavaScript-rendered pages (chosen per source, hardcoded in that
  source's own `CrawlStrategy` module — see Data Sources below)
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

- **Next.js + React** — a crawler management console SPA, organized with **Feature-Sliced Design
  (FSD)**: layers `app → widgets → features → entities → shared` (import rule in "Architecture
  methodologies" below). The FSD skeleton and auth building blocks
  ([`entities/session`](apps/web/entities/session), `useRequireAuth`,
  [`shared/lib/api.ts`](apps/web/shared/lib/api.ts), `shared/ui`) were carried over from an
  earlier starting point; everything else calls our own Express API and is specific to this
  project. See [`README.md`](README.md#frontend-architecture-notes) for a plain-language
  explanation of SPA/FSD and how the shadcn/ui CLI writes into `apps/web/shared/ui/`.
- **shadcn/ui** — CLI-generated component source (e.g.
  [`button.tsx`](apps/web/shared/ui/button.tsx), [`card.tsx`](apps/web/shared/ui/card.tsx)) in
  [`apps/web/shared/ui/`](apps/web/shared/ui/) — owned, freely editable, not an npm package.

### Infrastructure

- **Docker + Docker Compose** — Local environment (Postgres, Redis, Elasticsearch)

## Data Sources

This app aggregates **developer/tech vacancies specifically, not vacancies in general**. Every
source is scoped to that either "for free" (`habr_career`/`remoteok` are tech-only sites by
nature, `weworkremotely`'s seeded categories are programming-only) or, for a general-purpose site
like `craigslist`, via an explicit crawl-time category filter (`cat=sof`). Any future
general-purpose source must be scoped to tech/dev roles the same way.

All four seeded sources — `habr_career`, `remoteok`, `weworkremotely`, and `craigslist` — have
working `CrawlStrategy` implementations. Each source's `defaultDelayMs`, base URL, and
`maxVacanciesToCrawl` live on the `CrawlSource` row itself
([`apps/api/prisma/seed.ts`](apps/api/prisma/seed.ts)) — there's no separate per-run
configuration. There is no stored fetch-mechanism field — which library a source uses
(Axios+Cheerio vs. Puppeteer) is defined by its `CrawlStrategy` module and surfaced to the UI
via that strategy's own `description`, not a separate DB classification that could drift from it.

| Key | Site | Status | Fetch mechanism |
| --- | --- | --- | --- |
| `habr_career` | [career.habr.com](https://career.habr.com) | Implemented | Axios+Cheerio |
| `remoteok` | [remoteok.com](https://remoteok.com) | Implemented | Puppeteer (listing only) |
| `weworkremotely` | [weworkremotely.com](https://weworkremotely.com) | Implemented | Puppeteer (listing) + RSS via Axios (detail) |
| `craigslist` | [craigslist.org](https://craigslist.org) | Implemented | Axios+Cheerio (multi-city `CrawlListing` fan-out, `cat=sof` category) |

Full per-source rationale (why each strategy, robots.txt/Cloudflare findings, the retired
`moikrug` → Habr redirect) is in the `data-sources` skill
([`.claude/skills/data-sources/SKILL.md`](.claude/skills/data-sources/SKILL.md)) — Claude Code
loads it when touching crawler strategies or discussing a source's specifics.

## Coding Standards

- Strict TypeScript usage (interfaces/types instead of `any`)

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
  no-auto-merge rule) are in the `git-workflow` skill
  ([`.claude/skills/git-workflow/SKILL.md`](.claude/skills/git-workflow/SKILL.md)) —
  Claude Code loads it automatically when committing or opening a PR.

### Feature design docs (`.claude/features/`)

Every non-trivial feature or increment gets a design doc in [`.claude/features/`](.claude/features/),
written (or updated) as part of that work — not after; it's the durable record of **why** behind
the code. Naming convention, required contents, and sync rules are in the `feature-design-docs`
skill ([`.claude/skills/feature-design-docs/SKILL.md`](.claude/skills/feature-design-docs/SKILL.md))
— Claude Code loads it when starting or updating a feature doc.

## User Stories (MVP)

As a user I can:

1. Register and log in (JWT Authentication)
2. View a list of predefined data sources (see Data Sources above)
3. Start / Stop a crawl for a source, or crawl all sources at once — crawling is a shared,
   global operation (not scoped to me); any logged-in user can trigger it (see Security
   Considerations). Crawl strategy, delay, and vacancy volume are not configurable per run — they
   come from the selected `CrawlSource`'s own `defaultDelayMs`/`maxVacanciesToCrawl` (the strategy
   itself is chosen by `CrawlSource.name`, not a stored field).
4. See the status and progress of a source's crawl runs, including execution logs
5. Search through all collected vacancies using Elasticsearch — free text plus facets
   (Specialization, Seniority level, Remote/On-site, Location, Company) and relevance sorting
6. Receive AI-enriched summaries of crawled content (future increment)

## Data Models (summary)

Full field definitions live in [`ARCHITECTURE.md`](ARCHITECTURE.md). Core entities:

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

Elasticsearch is a derived search index, not the source of truth — PostgreSQL holds the
authoritative records. Schema-versioning, rebuild mechanics, and how a rebuild relates to crawl
history are in the `elasticsearch-conventions` skill
([`.claude/skills/elasticsearch-conventions/SKILL.md`](.claude/skills/elasticsearch-conventions/SKILL.md))
— Claude Code loads it when touching `apps/api/src/search`.

## Technical Guidelines & Axioms

- All code, documentation, comments, variable names, function names, folder names, and UI text must be in **English**.
- The entire project interface and user-facing content should be in English.
- Russian can only be used in personal development notes (`.notes/`, git-ignored), and in
  [`.claude/doc/`](.claude/doc/) — a deliberate, tracked exception: that directory holds Sergei's
  personal learning/presentation write-ups of the tech stack, not project or user-facing
  documentation. See [`.claude/doc/CLAUDE.md`](.claude/doc/CLAUDE.md) for the conventions
  governing that directory.
- Crawling is global, not scoped to a user — see Security Considerations.
- Respect `robots.txt` and implement rate limiting (via Redis).
- Puppeteer vs Axios/Cheerio is chosen per source (hardcoded in that source's own `CrawlStrategy`
  module, surfaced via `CrawlStrategy.description` — not a stored `CrawlSource` field), never a
  per-run setting.
- AI enrichment goes through an interface; ship a `MockAIEnricher` first, real Claude API later.
- Keep the architecture modular and easy to extend.
- Prefer simplicity for MVP (avoid over-engineering).
- Whenever a step changes, adds to, or invalidates something described in `CLAUDE.md`,
  [`README.md`](README.md), or [`ARCHITECTURE.md`](ARCHITECTURE.md), update the affected file(s)
  as part of that step — don't let the docs drift out of sync with the code.

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
  [`.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md`](.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md)
  for why this was deferred rather than built now.
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
styling) is in the `ui-design-guidelines` skill
([`.claude/skills/ui-design-guidelines/SKILL.md`](.claude/skills/ui-design-guidelines/SKILL.md))
— Claude Code loads it automatically when writing or editing `apps/web` UI code.

## Testing Philosophy

- Primary testing method: **manual testing** through the browser. Automated tests exist for
  `apps/api`'s crawler/search logic (Vitest — run with `npm run test` inside `apps/api`); expand
  them for critical paths and regressions as the codebase grows.
- Full testing goals, the "before marking Done" checklist requirement, and the browser-automation
  policy are in the `testing-philosophy` skill
  ([`.claude/skills/testing-philosophy/SKILL.md`](.claude/skills/testing-philosophy/SKILL.md)).

## Project Structure (Target)

Monorepo with two apps: `apps/api` (Express) and `apps/web` (Next.js, FSD). Full target directory
layout is in [`README.md`](README.md#project-structure).
