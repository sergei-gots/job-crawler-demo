# JobCrawler Demo

A modular demonstration web application showcasing a modern web crawling and data processing
stack: TypeScript/Express backend, Puppeteer/Axios crawling, Elasticsearch search, Redis, JWT auth,
and AI enrichment via the Claude API. See `CLAUDE.md` for the full spec and `ARCHITECTURE.md` for
data models and component design.

## Status: implemented so far

- Monorepo scaffold (npm workspaces): `apps/api` (Express) + `apps/web` (Next.js)
- `apps/api`: minimal Express + TypeScript server, Winston logging, `GET /health`
- `apps/web`: Next.js (App Router, TypeScript, Tailwind), ready for Feature-Sliced Design layers

Not yet implemented: JWT auth, crawler, Elasticsearch/Redis integration, AI enrichment, search UI.
Track progress against the MVP plan in `CLAUDE.md` → User Stories.

## Getting started

Requirements: Node.js 24+, npm 11+.

```bash
npm install        # installs both apps/api and apps/web
npm run dev:api     # apps/api  → http://localhost:4000  (GET /health)
npm run dev:web     # apps/web  → http://localhost:3000
```

Each app also has its own `.env` (see `apps/api/.env.example`); copy it to `.env` before running.

## Project structure

```
/apps
  /api    # Express backend (crawler, AI enrichment, search, auth)
  /web    # Next.js frontend (Feature-Sliced Design)
```

See `CLAUDE.md` → Project Structure for the full target layout.
