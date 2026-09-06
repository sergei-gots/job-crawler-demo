# Job-Crawler-Demo

A modular demonstration web application that crawls and aggregates developer/tech job vacancies,
showcasing a modern web crawling and data processing stack:

- **Backend**: Node.js, Express, TypeScript
- **Frontend**: Next.js, React, Tailwind CSS
- **Crawling**: Puppeteer, Axios + Cheerio
- **Data**: PostgreSQL, Elasticsearch, Redis
- **Auth**: JWT
- **AI enrichment**: Claude API (planned)

See `CLAUDE.md` for the full spec and `ARCHITECTURE.md` for data models and component design.

## Table of contents

- [Getting started](#getting-started)
  - [1. Start infrastructure](#1-start-infrastructure)
  - [2. Install dependencies](#2-install-dependencies)
  - [3. Configure environment variables](#3-configure-environment-variables)
  - [4. Apply database migrations and seed data](#4-apply-database-migrations-and-seed-data)
  - [5. Run the apps](#5-run-the-apps)
  - [Where everything runs](#where-everything-runs)
- [What this application does](#what-this-application-does)
- [Checking crawled data](#checking-crawled-data)
  - [Option A — via the API](#option-a--via-the-api)
  - [Option B — query Elasticsearch directly](#option-b--query-elasticsearch-directly)
  - [Why a run sometimes shows `cache: miss` right after a previous one](#why-a-run-sometimes-shows-cache-miss-right-after-a-previous-one)
- [Project structure](#project-structure)
- [Frontend architecture notes](#frontend-architecture-notes)
- [Further reading](#further-reading)

## Getting started

Requirements: Node.js 24+, npm 11+, Docker (for Postgres, Redis, Elasticsearch).

### 1. Start infrastructure

```bash
docker compose up -d
```

See `docker-compose.yml` for the exact service definitions.

### 2. Install dependencies

```bash
npm install
```

This is the plain npm command, not a script we defined. It works across both apps because of the
root `package.json`'s `"workspaces": ["apps/*"]` field: npm reads `apps/api/package.json` and
`apps/web/package.json` alongside the root one and installs everything into a single root
`node_modules` (with the two apps symlinked in) — one `npm install` at the repo root covers both
apps, no need to `cd` into each separately.

### 3. Configure environment variables

Each app has its own `.env` file. Copy the example files and fill them in:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

`apps/api/.env` needs:

- `DATABASE_URL` — pointing at the Postgres container
- `REDIS_URL` — pointing at the Redis container
- `ELASTICSEARCH_URL` — pointing at the Elasticsearch container
- `JWT_SECRET`

### 4. Apply database migrations and seed data

```bash
npm run --workspace apps/api prisma:migrate
```

```bash
npm run --workspace apps/api prisma:seed
```

The seed script populates the predefined crawl sources (Habr Career, RemoteOK, WeWorkRemotely,
Craigslist).

### 5. Run the apps

```bash
npm run dev:api
```

```bash
npm run dev:web
```

`dev:api`/`dev:web`/`build`/`lint` are our own scripts (see `package.json` → `scripts`), each
delegating to the matching command inside that workspace via:

```bash
npm run <script> --workspace <path>
```

### Where everything runs

| Service | Port | URL | Notes |
| --- | --- | --- | --- |
| Web app (Next.js) | `3000` | http://localhost:3000 | Main UI |
| API (Express) | `4000` | http://localhost:4000 | `GET /health` to check it's up |
| Postgres | `5435` | `localhost:5435` | Users, crawl runs/logs, sources |
| Redis | `6380` | `localhost:6380` | Rate limiting + short-TTL page cache |
| Elasticsearch | `9200` | http://localhost:9200 | Crawled vacancy index (`crawler_results`) |

## What this application does

Once running, this is what you can actually do in it:

1. **Register and log in** — JWT-based auth (`/auth/register`, `/auth/login`).
2. **Browse the predefined data sources** — Habr Career, RemoteOK, WeWorkRemotely, and Craigslist
   (scoped to `cat=sof`), each with its own crawl strategy under the hood.
3. **Start or stop a crawl** — per source, or all sources at once. Crawling is a shared, global
   operation: any logged-in user can trigger or stop it, since results aren't owned per user (see
   `CLAUDE.md` → Security Considerations).
4. **Watch a crawl run** — status, progress, and live execution logs per source.
5. **Search collected vacancies** — free text plus facets (Specialization, Seniority level,
   Remote/On-site, Location, Company) and relevance sorting, backed by Elasticsearch.
6. **AI-enriched summaries** — planned, not yet implemented; will run through a swappable
   `AIEnricher` interface (`MockAIEnricher` first, Claude API later).

For *why* each piece was built the way it was (crawl-strategy choices, robots.txt/Cloudflare
findings, schema decisions), see the `.claude/features/` design docs and the `data-sources` /
`elasticsearch-conventions` skills referenced from `CLAUDE.md`.

## Checking crawled data

There's no full vacancy list in the UI yet beyond the Source detail page's simple list — the
**Execution logs** panel on that page shows crawl progress, not the parsed results themselves. Two
ways to see everything that was actually crawled:

### Option A — via the API

First get a JWT:

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"..."}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['accessToken'])")
```

All vacancies collected for one source (Habr Career is source id `1` in the default seed):

```bash
curl -s http://localhost:4000/sources/1/vacancies -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

A global, keyword+facet search across every source's vacancies:

```bash
curl -s "http://localhost:4000/vacancies/search?q=python&isRemote=true&seniority=Middle" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Autocomplete suggestions for the search box (distinct `title`/`company` values, case-insensitive
prefix match):

```bash
curl -s "http://localhost:4000/vacancies/suggest?q=Je" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Option B — query Elasticsearch directly

No auth needed, since it's a local dev container:

```bash
curl -s "http://localhost:9200/crawler_results/_search?pretty&size=50"
```

```bash
curl -s "http://localhost:9200/crawler_results/_count"
```

Each vacancy document's `_id` is `{sourceId}:{externalId}` — re-crawling the same source doesn't
duplicate a vacancy, it just bumps that document's `lastSeenAt`.

### Why a run sometimes shows `cache: miss` right after a previous one

The raw HTML page fetched per crawl (listing pages and each vacancy's detail page) is cached in
Redis for 1 hour (`PAGE_CACHE_TTL_SECONDS` in `apps/api/src/crawler/pageCache.ts`) — long enough to
cover a full habr_career run (~15 min at the seeded rate limit), short enough to not matter for
freshness. Two runs more than an hour apart will both hit the network; two runs within that window
will show `cache: hit` in `CrawlLog` for pages already fetched.

## Project structure

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

## Frontend architecture notes

- **Next.js + React** SPA (Single-Page Application: the page loads once, then navigation/updates
  happen in the browser via JavaScript instead of a full page reload per click), organized with
  **Feature-Sliced Design (FSD)** — a way of arranging frontend code into layers by *what a piece
  of code is for* (e.g. a reusable button vs. a page-specific feature vs. a whole page's widget),
  so that code for one concern doesn't get tangled with code for another. Layers:
  `app → widgets → features → entities → shared` (see `CLAUDE.md` → Architecture methodologies
  for the import rule between them).
  The FSD layer skeleton and the auth building blocks (login/register pages, the
  `entities/session` slice, the `useRequireAuth` hook, the `shared/lib/api.ts` HTTP client, the
  `shared/ui` component folder) were carried over from an earlier starting point rather than built
  from scratch. Everything else — what the app does, its pages/features/entities, and the backend
  it talks to — is specific to this project: it calls our own Express API.
- **shadcn/ui** is not an installed npm component library; it's a CLI (configured in
  `apps/web/components.json`) that generates a component's source code (e.g. `button.tsx`,
  `card.tsx`) and writes it directly into `apps/web/shared/ui/`. Those files become ordinary
  project source — owned and freely editable — not files pulled from `node_modules`. The
  `"ui": "@/shared/ui"` alias in `components.json` is what tells the CLI which folder to write
  generated components into.

## Further reading

- `CLAUDE.md` — full project spec, tech stack, data sources, security considerations.
- `ARCHITECTURE.md` — data models and component design.
- `.claude/features/` — per-increment design docs (the "why" behind each build step).
- `.claude/doc/` — plain-language write-ups of the tech stack (Russian, personal learning notes).
