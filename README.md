# JobCrawler Demo

A modular demonstration web application showcasing a modern web crawling and data processing
stack: TypeScript/Express backend, Puppeteer/Axios crawling, Elasticsearch search, Redis, JWT auth,
and AI enrichment via the Claude API.

See `CLAUDE.md` for the full spec and `ARCHITECTURE.md` for data models and component design.

## Status: implemented so far

- Monorepo scaffold (npm workspaces): `apps/api` (Express) + `apps/web` (Next.js).
- `apps/api`: Express + TypeScript server, Winston logging, `GET /health`.
- PostgreSQL via Docker Compose, Prisma ORM, `User` model (email, password hash, optional name).
- JWT auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`.
- Profile management: `PATCH /users/me` (name + email, requires current password),
  `PATCH /users/me/password`.
- `apps/web`: Next.js (App Router, TypeScript, Tailwind), Feature-Sliced Design layers
  (`entities/session`, `entities/user`, `features/auth`, `features/profile`,
  `widgets/sidebar`, `widgets/dashboard`, `widgets/profile`) — login/register pages, a
  protected dashboard stub, and a profile page (edit name, change password).

**Sources & Crawler Jobs — Increment 1** (see `.claude/features/FEATIRE_SOURCES_AND_JOBS.md`):

- `CrawlSource`, `CrawlerJob`, `JobLog` Prisma models, seeded with four sources (Habr Career,
  RemoteOK, WeWorkRemotely, Craigslist — matches `CLAUDE.md` → Data Sources).
- Endpoints: `GET /sources`, `GET /sources/:id`, `GET /crawler-jobs`, `POST /crawler-jobs`,
  `GET /crawler-jobs/:id`, `POST /crawler-jobs/:id/start`, `POST /crawler-jobs/:id/stop` (all
  user-scoped, behind JWT auth).
- Frontend: `entities/source`, `entities/crawler-job`, `features/create-crawler-job`,
  `features/run-crawler-job`, `widgets/sources`, `widgets/crawler-jobs`,
  `widgets/crawler-job-detail`, plus `/sources`, `/crawler-jobs`, `/crawler-jobs/[id]` pages.

**Real crawler + Redis + minimal Elasticsearch — Increment 2** (see
`.claude/features/FEATURE_REAL_CRAWLER_REDIS_ES.md`):

- `POST /crawler-jobs/:id/start` runs a real Axios+Cheerio crawl of `career.habr.com` — the only
  source with a parser so far (Puppeteer turned out unnecessary; see the doc's spike notes).
  Other seeded sources log a `WARN` and are skipped rather than failing the job.
- Redis (`apps/api/src/crawler/`) provides per-source rate limiting and a short-TTL raw-page
  cache.
- Elasticsearch (`apps/api/src/search/`) stores parsed vacancies, deduplicated by
  `sourceId:externalId`.
- New read endpoints: `GET /sources/:id/vacancies`, `GET /crawler-jobs/:id/vacancies`, plus a
  simple vacancy list on the crawler job detail page — see "Checking crawled data" below.
- No AI enrichment and no Coveo-like search/facet UI yet.

Not yet implemented: AI enrichment, Coveo-like search/facet UI, additional source parsers
(RemoteOK, WeWorkRemotely, Craigslist). Track progress against the MVP plan in `CLAUDE.md` → User
Stories.

## Getting started

Requirements: Node.js 24+, npm 11+, Docker (for Postgres, Redis, Elasticsearch).

### 1. Start infrastructure

```bash
docker compose up -d
```

Brings up Postgres (`localhost:5435`), Redis (`localhost:6380`), and Elasticsearch
(`localhost:9200`) — see `docker-compose.yml` for the exact service definitions.

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

`apps/api/.env` needs `DATABASE_URL` (pointing at the Postgres container),
`REDIS_URL`/`ELASTICSEARCH_URL` (pointing at the other two containers), and a `JWT_SECRET`.

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

Starts `apps/api` on `http://localhost:4000` (`GET /health` to check it's up).

```bash
npm run dev:web
```

Starts `apps/web` on `http://localhost:3000`.

`dev:api`/`dev:web`/`build`/`lint` are our own scripts (see `package.json` → `scripts`), each
delegating to the matching command inside that workspace via `npm run <script> --workspace <path>`.

## Checking crawled data

There's no full vacancy list in the UI yet beyond the crawler job detail page's simple list (see
Increment 2 above) — the **Execution logs** panel on that page shows crawl progress, not the
parsed results themselves. Two ways to see everything that was actually crawled:

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

Vacancies for one crawler job, filtered by that job's keywords:

```bash
curl -s http://localhost:4000/crawler-jobs/<job-id>/vacancies -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
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

The raw HTML page fetched per crawl is cached in Redis for 15 minutes
(`PAGE_CACHE_TTL_SECONDS` in `apps/api/src/crawler/pageCache.ts`) — long enough to spare the
source from duplicate near-simultaneous requests, short enough to not matter for freshness. Two
runs more than 15 minutes apart will both hit the network; two runs within that window will show
`cache: hit` on the second one in its `JobLog`.

## Project structure

```
/apps
  /api    # Express backend (crawler, AI enrichment, search, auth)
  /web    # Next.js frontend (Feature-Sliced Design)
```

See `CLAUDE.md` → Project Structure for the full target layout.
