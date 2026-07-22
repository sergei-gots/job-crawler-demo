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

## Data Sources

Given a 2-week timeline, MVP scope is **one source, done well**, rather than three done thinly:

| Key           | Site                     | Status   | Puppeteer                                                             | Notes                                               |
| ------------- | ------------------------ | -------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| `habr_career` | career.habr.com          | MVP      | tbd — verify against real robots.txt/markup when building the crawler | RU tech jobs; good fit for AI skill-extraction demo |
| `moikrug`     | moikrug.ru               | post-MVP | false                                                                 | hh-like, simpler markup                             |
| `craigslist`  | craigslist.org (SW jobs) | post-MVP | false                                                                 | International example, multiple cities              |

`moikrug` and `craigslist` are deferred — add them later as additional `CrawlStrategy` adapters if
time allows, without changing the crawler architecture.

For the active source we define: `usePuppeteer` (true/false), base URL(s), and the CSS selectors /
fields to parse. Always respect the site's `robots.txt` and apply rate limiting.

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
- **No automatic merges, ever.** Every change lands on a feature branch and goes through a PR;
  `main` only moves when the user reviews and merges it themselves. Claude never merges a PR,
  even if asked to "just finish it up" — merging is always a manual, explicit user action.
- Every PR description must include, in full: (1) a step-by-step account of what was actually
  done (not just a summary — enough detail that the user can follow the reasoning without
  re-reading the diff), and (2) a **review checklist** of concrete things the user should verify
  before merging (commands to run, URLs to open, edge cases to try, anything not covered by
  automated checks).

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

## Product UI Principles

This application is a crawler management console.

Prioritize:
- clarity of workflows over visual decoration
- showing job status and progress
- clear distinction between configuration and results
- operational information visibility

Main user actions should be obvious:
- create crawler job
- configure source
- run crawler
- inspect results
- review history

## UI Design Guidelines

Reference screenshots live in `.claude/.design-samples/` (git-ignored, local-only).
Use those samples as the default visual language. Introduce new patterns only when the workflow
requires them.

- **Application pages should not use centered layouts.** Page content is left-positioned with
  breathing-room padding (`items-start justify-start p-8 md:p-16` for full-page forms like
  login/register; `justify-start p-4 md:p-8` for the main content area next to the sidebar) — this
  is the current choice for login/register too. Standalone marketing/auth screens may use centered
  layouts if explicitly designed that way (e.g. a future landing page) — this isn't a blanket ban,
  just the default for everything we've built so far.
- **Boxed sections, not flat lists.** Any logically distinct block of UI (a form, the sidebar's
  user info, the sidebar's nav) is wrapped in `shared/ui/card.tsx`'s `Card`/`CardHeader`/
  `CardTitle`/`CardDescription`/`CardContent` — not a bare `<div>`.
- **Separate cards, not dividers.** When two related sections sit in the same column (e.g. "Account
  details" and "Change password"), separate them with layout spacing (`gap-6` on the parent) —
  not a visible `<hr>` rule line.
- **Active navigation state must be visually distinguishable.** Prefer a border-based active state
  (`border border-border` on the active item, `border-transparent` on inactive ones to reserve the
  same width) unless another pattern is already established for that context.
- **Password fields always use `shared/ui/password-input.tsx`** (`PasswordInput`), never a bare
  `Input type="password"` — it's the standard show/hide-toggle wrapper for every password field
  app-wide (login, register, change-password, etc.).
- **Use design tokens, not hardcoded colors.** Prefer `text-muted-foreground`, `border-border`,
  `text-foreground` etc. (defined in `app/globals.css`) over hardcoded Tailwind colors like
  `text-zinc-500` — the codebase had drifted into mixing both; new/touched code should use tokens.
- **Auth-screen structure**: `CardTitle` + a one-line `CardDescription` explaining the action,
  full-width submit button (default `Button`, no `w-fit`). In-page forms (profile, settings)
  instead use `className="w-fit"` on their submit button — full-width there would look oversized
  next to a left-aligned card.

## Testing Philosophy

- Primary testing method: **Manual testing** through the browser.
- The developer will manually check the web interface, user flows, and visual appearance.
- Do not use Claude Chrome Extension or any browser automation tools for regular development and testing unless explicitly requested.
- Automated tests (if any) will be added later for critical paths and regression.

**Manual Testing Goals:**

- Evaluate real User Experience (UX)
- Check visual layout and responsiveness
- Verify business workflows and usability
- Catch issues that automated tools often miss

**Before marking a feature as "Done":**

- Developer must perform manual testing
- Provide a short **Manual Testing Checklist** for the implemented feature

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
