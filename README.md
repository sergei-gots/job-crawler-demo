# JobCrawler Demo

A modular demonstration web application showcasing a modern web crawling and data processing
stack: TypeScript/Express backend, Puppeteer/Axios crawling, Elasticsearch search, Redis, JWT auth,
and AI enrichment via the Claude API. See `CLAUDE.md` for the full spec and `ARCHITECTURE.md` for
data models and component design.

## Status: implemented so far

- Monorepo scaffold (npm workspaces): `apps/api` (Express) + `apps/web` (Next.js)
- `apps/api`: Express + TypeScript server, Winston logging, `GET /health`
- PostgreSQL via Docker Compose, Prisma ORM, `User` model (email, password hash, optional
  first/last name)
- JWT auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- Profile management: `PATCH /users/me` (name), `PATCH /users/me/password`
- `apps/web`: Next.js (App Router, TypeScript, Tailwind), Feature-Sliced Design layers
  (`entities/session`, `entities/user`, `features/auth`, `features/profile`,
  `widgets/sidebar`, `widgets/dashboard`, `widgets/profile`) — login/register pages, a
  protected dashboard stub, and a profile page (edit name, change password)

Not yet implemented: crawler, Elasticsearch/Redis integration, AI enrichment, search UI.
Track progress against the MVP plan in `CLAUDE.md` → User Stories.

## Getting started

Requirements: Node.js 24+, npm 11+, Docker (for Postgres).

```bash
docker compose up -d db   # Postgres on localhost:5435 (container: job-crawler-db)
npm install                # installs both apps/api and apps/web
npm run dev:api             # apps/api  → http://localhost:4000  (GET /health)
npm run dev:web             # apps/web  → http://localhost:3000
```

Each app also has its own `.env` (see `apps/api/.env.example` and `apps/web/.env.example`); copy
each to `.env` (`apps/web` uses `.env.local`) before running. `apps/api` needs `DATABASE_URL`
pointing at the Postgres container and a `JWT_SECRET`. After the database is up, run migrations
once from `apps/api`:

```bash
npm run --workspace apps/api prisma:migrate
```

## Project structure

```
/apps
  /api    # Express backend (crawler, AI enrichment, search, auth)
  /web    # Next.js frontend (Feature-Sliced Design)
```

See `CLAUDE.md` → Project Structure for the full target layout.
