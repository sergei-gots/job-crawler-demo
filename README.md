# JobCrawler Demo

A modular demonstration web application showcasing a modern web crawling and data processing
stack: TypeScript/Express backend, Puppeteer/Axios crawling, Elasticsearch search, Redis, JWT auth,
and AI enrichment via the Claude API. See `CLAUDE.md` for the full spec and `ARCHITECTURE.md` for
data models and component design.

## Status: implemented so far

- Monorepo scaffold (npm workspaces): `apps/api` (Express) + `apps/web` (Next.js)
- `apps/api`: Express + TypeScript server, Winston logging, `GET /health`
- PostgreSQL via Docker Compose, Prisma ORM, `User` model (email, password hash, optional name)
- JWT auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- Profile management: `PATCH /users/me` (name + email, requires current password),
  `PATCH /users/me/password`
- `apps/web`: Next.js (App Router, TypeScript, Tailwind), Feature-Sliced Design layers
  (`entities/session`, `entities/user`, `features/auth`, `features/profile`,
  `widgets/sidebar`, `widgets/dashboard`, `widgets/profile`) — login/register pages, a
  protected dashboard stub, and a profile page (edit name, change password)
- Sources & Crawler Jobs (Increment 1, see `.claude/features/FEATIRE_SOURCES_AND_JOBS.md`):
  `CrawlSource`, `CrawlerJob`, `JobLog` Prisma models, seeded with three sources (Habr Career,
  Moikrug, Craigslist — matches `CLAUDE.md` → Data Sources). Endpoints: `GET /sources`,
  `GET /sources/:id`, `GET /jobs`, `POST /jobs`, `GET /jobs/:id`, `POST /jobs/:id/start`,
  `POST /jobs/:id/stop` (all user-scoped, behind JWT auth). Frontend: `entities/source`,
  `entities/job`, `features/create-crawler-job`, `features/run-job`, `widgets/sources`,
  `widgets/jobs`, `widgets/job-detail`, plus `/sources`, `/jobs`, `/jobs/[id]` pages.
  **Start/Stop currently runs a mock in-process runner** (`apps/api/src/jobs/jobs.runner.ts`)
  that simulates progress by writing timed `JobLog` rows and flipping job status — there is no
  real Puppeteer/Cheerio crawling, `robots.txt` handling, or Redis rate limiting yet.

Not yet implemented: real crawler execution, Redis rate limiting/job state, Elasticsearch
storage + search UI, AI enrichment. Track progress against the MVP plan in `CLAUDE.md` → User
Stories.

## Getting started

Requirements: Node.js 24+, npm 11+, Docker (for Postgres).

```bash
docker compose up -d db   # Postgres on localhost:5435 (container: job-crawler-db)
npm install                # installs both apps/api and apps/web
npm run dev:api             # apps/api  → http://localhost:4000  (GET /health)
npm run dev:web             # apps/web  → http://localhost:3000
```

`npm install` here is the plain npm command, not a script we defined — there's no `install` entry
in `package.json` `scripts`. It behaves this way because of the root `package.json`'s
`"workspaces": ["apps/*"]` field: npm reads `apps/api/package.json` and `apps/web/package.json`
alongside the root one and installs everything into a single root `node_modules` (with the two
apps symlinked in), so one `npm install` at the repo root covers both apps — no need to `cd` into
each and install separately. `dev:api`/`dev:web`/`build`/`lint`, by contrast, *are* our own scripts
(see `package.json` → `scripts`), each delegating to the matching command inside that workspace via
`npm run <script> --workspace <path>`.

Each app also has its own `.env` (see `apps/api/.env.example` and `apps/web/.env.example`); copy
each to `.env` (`apps/web` uses `.env.local`) before running. `apps/api` needs `DATABASE_URL`
pointing at the Postgres container and a `JWT_SECRET`. After the database is up, run migrations
once from `apps/api`:

```bash
npm run --workspace apps/api prisma:migrate
npm run --workspace apps/api prisma:seed   # seeds the predefined crawl sources
```

## Project structure

```
/apps
  /api    # Express backend (crawler, AI enrichment, search, auth)
  /web    # Next.js frontend (Feature-Sliced Design)
```

See `CLAUDE.md` → Project Structure for the full target layout.
