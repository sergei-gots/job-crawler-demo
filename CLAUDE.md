# CLAUDE.md - JobCrawler Demo

## Project Overview

**Project Name:** JobCrawler Demo  
**Description:** A modular demonstration web application showcasing a modern web crawling and data processing stack, inspired by enterprise data crawling systems (e.g. SAP-style).

**Goal:**  
Create a clean, well-structured MVP that demonstrates the full tech stack: TypeScript + Node.js crawling framework with Puppeteer, Elasticsearch, Redis, AI enrichment, and user personalization.

## Tech Stack

### Backend (`apps/api`)
- **TypeScript + Node.js + Express** — Core backend and REST API
- **Puppeteer** — Crawling JavaScript-rendered pages (only when enabled per job)
- **Axios + Cheerio** — Fast static page crawling
- **PostgreSQL** — Store users, Crawler Jobs, job logs, settings
- **Redis** — Rate limiting, simple job queue/state, caching
- **Elasticsearch** — Main storage and search engine for crawled results
- **Coveo-like layer** — Light abstraction above Elasticsearch that mimics a Coveo-style
  search experience (facets, relevance sorting). Saved searches are **out of scope for MVP**.
- **JWT Authentication** — User registration, login and ownership of jobs/results
- **Claude API** — AI enrichment (summarization, skill extraction, categorization).
  Start with a `MockAIEnricher`; wire the real API (key in `.env`) in a later stage.
- **Winston** — Structured logging

### Frontend (`apps/web`)
- **Next.js + React** — Dashboard SPA, organized with **Feature-Sliced Design (FSD)**.
  Reuses the FSD skeleton and auth flow patterns from the Expense Tracker project
  (login/register, `entities/session`, `useRequireAuth`, `shared/lib/api.ts`, `shared/ui`),
  but talks to **our Express API** — we do NOT adopt NestJS.
- **shadcn/ui** — UI components routed into `shared/ui`

### Infrastructure
- **Docker + Docker Compose** — Local environment (Postgres, Redis, Elasticsearch)

## Data Sources (MVP)

Predefined sources the user can select when creating a Crawler Job:

| Key             | Site                     | Puppeteer | Notes                                   |
|-----------------|--------------------------|-----------|-----------------------------------------|
| `habr_career`   | career.habr.com          | tbd       | Primary source (RU tech jobs)           |
| `moikrug`       | moikrug.ru               | false     | hh-like, simpler markup                 |
| `craigslist`    | craigslist.org (SW jobs) | false     | International example, multiple cities  |

For each source we define: `usePuppeteer` (true/false), base URL(s), and the CSS selectors /
fields to parse. Always respect each site's `robots.txt` and apply rate limiting.

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

- Use meaningful commit messages in English.
- Work in feature branches (e.g. `feat/create-crawler-job`, `fix/crawler-rate-limit`).
- Keep `main` branch stable.
- Commit often, push regularly.
- All code must be in English.
- Claude drafts the commit message(s) and the pull request description for each step of work,
  in the usual format: a summary of what changed and why, plus a test plan / checklist of what
  still needs manual review or testing (e.g. "not yet covered by automated tests — verify
  manually: ..."). The user reviews and creates the actual PR.

## User Stories (MVP)

As a user I can:

1. Register and log in (JWT Authentication)
2. View a list of predefined data sources (see Data Sources above)
3. Create a new Crawler Job:
   - Job name
   - Select data sources
   - Define keywords/filters
   - Configure parameters (delay, depth, use Puppeteer or not)
4. Start / Stop my Crawler Jobs
5. See the status and progress of my jobs
6. Search through collected data using Elasticsearch (Coveo-like facets + relevance)
7. View execution logs for each job
8. Receive AI-enriched summaries of crawled content

## Data Models (summary)

Full field definitions live in `ARCHITECTURE.md`. Core entities:

- **User** — PostgreSQL. Owns everything.
- **CrawlerJob** — PostgreSQL. Belongs to a `userId`; holds config + status.
- **CrawlerResult** — Elasticsearch (primary). A crawled + AI-enriched job posting.
- **JobLog** — PostgreSQL. Execution log lines per job.

## Technical Guidelines & Axioms

- All code, documentation, comments, variable names, function names, folder names, and UI text must be in **English**.
- The entire project interface and user-facing content should be in English.
- Russian can only be used in personal development notes (`.notes/`, git-ignored).
- Every Crawler Job belongs to a specific `userId`.
- Respect `robots.txt` and implement rate limiting (via Redis).
- Puppeteer should be used only when explicitly enabled in the job settings.
- AI enrichment goes through an interface; ship a `MockAIEnricher` first, real Claude API later.
- Keep the architecture modular and easy to extend.
- Prefer simplicity for MVP (avoid over-engineering).
- Whenever a step changes, adds to, or invalidates something described in `CLAUDE.md`,
  `README.md`, or `ARCHITECTURE.md`, update the affected file(s) as part of that step —
  don't let the docs drift out of sync with the code.

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
      /workers         # job runner / queue consumers
      /types
  /web                 # Next.js frontend (FSD)
    /app               # routing only
    /widgets           # dashboard, job-list, search, sidebar
    /features          # auth, create-crawler-job, run-job, search
    /entities          # session, user, job, result
    /shared            # ui/, lib/ (api client)
/docker                # docker-compose + service configs
```
