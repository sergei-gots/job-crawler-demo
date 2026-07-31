# Job-Crawler-Demo

A modular demonstration web application showcasing a modern web crawling and data processing
stack:

- **Backend**: Node.js, Express, TypeScript
- **Frontend**: Next.js, React, Tailwind CSS
- **Crawling**: Puppeteer, Axios + Cheerio
- **Data**: PostgreSQL, Elasticsearch, Redis
- **Auth**: JWT
- **AI enrichment**: Claude API

See `CLAUDE.md` for the full spec and `ARCHITECTURE.md` for data models and component design.

## Status: implemented so far

- Monorepo scaffold (npm workspaces): `apps/api` (Express) + `apps/web` (Next.js).
- `apps/api`: Express + TypeScript server, Winston logging, `GET /health`.
- PostgreSQL via Docker Compose, Prisma ORM, `User` model (email, password hash, optional name).
- JWT auth:
  - `POST /auth/register`
  - `POST /auth/login`
  - `GET /auth/me`
- Profile management:
  - `PATCH /users/me` (name + email, requires current password)
  - `PATCH /users/me/password`
- `apps/web`: Next.js (App Router, TypeScript, Tailwind), Feature-Sliced Design. Layers so far:
  - `entities/session`, `entities/user`
  - `features/auth`, `features/profile`
  - `widgets/sidebar`, `widgets/dashboard`, `widgets/profile`

  Pages: login/register, a protected dashboard stub, and a profile page (edit name, change
  password).

### Sources & Crawling — Increment 1 → 3a

See `.claude/features/01_FEATURE_SOURCES_AND_JOBS.md` (original Increment 1 design) and
`.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md` (Increment 3a refactor — supersedes the
per-user `CrawlerJob` model described in that original doc).

- Prisma models: `CrawlSource`, `CrawlRun`, `CrawlLog`.
- Seeded with four sources (matches `CLAUDE.md` → Data Sources):
  - Habr Career
  - RemoteOK
  - WeWorkRemotely
  - Craigslist
- Crawling is a shared, global operation, not owned per user — any logged-in user can trigger a
  crawl of any source, or crawl all sources at once (see `CLAUDE.md` → Security Considerations).
- Endpoints (behind JWT auth; no per-user ownership check, since crawling has no owner):
  - `GET /sources`
  - `GET /sources/:id`
  - `POST /sources/:id/crawl`
  - `POST /sources/:id/crawl/stop`
  - `POST /sources/crawl-all`
  - `GET /sources/:id/run` (the source's latest `CrawlRun`, with its `CrawlLog[]`)
- Frontend:
  - `entities/source`
  - `features/run-crawl`
  - `widgets/sources`, `widgets/source-detail`
  - Pages: `/sources`, `/sources/[id]`

Increment 1 originally built this around a per-user `CrawlerJob` entity (pick sources + keywords,
own your own crawler jobs). Increment 3a removed it: `keywords` was always a read-time
Elasticsearch filter, never a crawl parameter, so bundling "which sources to crawl" with "how to
filter results" mixed two unrelated concerns. Crawling now lives directly on Sources; filtering/
search moved to its own page (Increment 3b).

### Real crawler + Redis + minimal Elasticsearch — Increment 2

See `.claude/features/02_FEATURE_REAL_CRAWLER_REDIS_ES.md`.

- Crawling a source runs a real Axios+Cheerio crawl of `career.habr.com` — the only source with a
  parser so far (Puppeteer turned out unnecessary; see the doc's spike notes). Other seeded
  sources log a `WARN` and are skipped rather than failing the run.
- Redis (`apps/api/src/crawler/`) provides per-source rate limiting and a short-TTL raw-page
  cache.
- Elasticsearch (`apps/api/src/search/`) stores parsed vacancies, deduplicated by
  `sourceId:externalId`.
- Read endpoint: `GET /sources/:id/vacancies`.
- A simple vacancy list on the Source detail page — see "Checking crawled data" below.
- No AI enrichment and no Coveo-like search/facet UI yet (Increment 3b).

### Vacancy detail crawl — Increment 2.2

See `.claude/features/02b_FEATURE_VACANCY_DETAIL_CRAWL.md`.

- After crawling the `habr_career` listing page(s), each vacancy's own detail page is fetched too
  and parsed via its `schema.org/JobPosting` JSON-LD block — adding `description`, `location`,
  `isRemote`, and `skillsSummary` (habr's own auto-generated "Навыки: ..." lead sentence, stored
  as raw text, not split into a skill list) to the stored vacancy.
- **No salary field.** A manual check found habr almost never discloses an actual salary (100%
  of ~150 sampled listings showed "not specified"); the only visible number is a market estimate
  for similar roles, not the employer's own figure — storing it as `salary` would misrepresent
  the source, so it's intentionally left out.
- **No cap on how many vacancies get a detail fetch per run** — every vacancy found by the
  listing pass is detail-crawled, bounded only by the existing `maxPagesToCrawl`. Detail requests
  share the same per-source rate limiter as the listing crawl (`habr_career`'s seeded
  `defaultDelayMs` is 12s), so a full run can take several minutes by design — crawling
  politeness was prioritized over run speed for this project.
- Each vacancy on the Source detail page has a small **"View raw ES data"** button that toggles a
  pretty-printed JSON dump of that vacancy's Elasticsearch document inline (the exact same object
  returned by `GET /sources/:id/vacancies`, no extra API call). Purely illustrative — this is a
  demo app, so the button makes the underlying Elasticsearch storage visible rather than hiding
  it behind the UI. Hovering the button shows a tooltip with the document's direct ES REST URL
  (`http://localhost:9200/crawler_results/_doc/{sourceId}:{externalId}`) for anyone who wants to
  `curl` it themselves.
- The `description`-aware keyword matching this increment added carries forward into
  Increment 3b's global search endpoint — see that section once it lands.

### Not yet implemented

- AI enrichment
- Coveo-like search/facet UI
- Additional source parsers (RemoteOK, WeWorkRemotely, Craigslist)

Track progress against the MVP plan in `CLAUDE.md` → User Stories.

## Getting started

Requirements: Node.js 24+, npm 11+, Docker (for Postgres, Redis, Elasticsearch).

### 1. Start infrastructure

```bash
docker compose up -d
```

Brings up:

- Postgres on `localhost:5435`
- Redis on `localhost:6380`
- Elasticsearch on `localhost:9200`

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

Starts `apps/api` on `http://localhost:4000` (`GET /health` to check it's up).

```bash
npm run dev:web
```

Starts `apps/web` on `http://localhost:3000`.

`dev:api`/`dev:web`/`build`/`lint` are our own scripts (see `package.json` → `scripts`), each
delegating to the matching command inside that workspace via `npm run <script> --workspace <path>`.

## Checking crawled data

There's no full vacancy list in the UI yet beyond the Source detail page's simple list (see
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

(A global, keyword+facet search across every source's vacancies is planned for Increment 3b —
see `.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md`.)

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

The raw HTML page fetched per crawl (listing pages and, since Increment 2.2, each vacancy's
detail page) is cached in Redis for 1 hour (`PAGE_CACHE_TTL_SECONDS` in
`apps/api/src/crawler/pageCache.ts`) — long enough to cover a full habr_career run (~15 min at
the seeded rate limit), short enough to not matter for freshness. Two runs more than an hour
apart will both hit the network; two runs within that window will show `cache: hit` in `CrawlLog`
for pages already fetched.

## Project structure

```
/apps
  /api    # Express backend (crawler, AI enrichment, search, auth)
  /web    # Next.js frontend (Feature-Sliced Design)
```

See `CLAUDE.md` → Project Structure for the full target layout.
