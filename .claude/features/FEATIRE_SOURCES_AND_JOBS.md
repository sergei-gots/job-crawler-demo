# FEATURE: Sources and Crawler Jobs Management

## Overview

This feature implements management of predefined crawling sources and user-specific Crawler Jobs for the Modular Crawler Demo project.

**Goal**: Give authenticated users the ability to browse available sources, create personalized crawler jobs, run them, and view results + logs.

## Status

**Increment 1 — implemented.** Data models, seed, the Sources (read-only) and Jobs (CRUD +
start/stop) API modules, and the corresponding frontend pages are in place. Start/Stop is backed
by a **mock in-process runner** (`apps/api/src/jobs/jobs.runner.ts`): it simulates progress by
writing timed `JobLog` rows and flipping the job status — there is **no real Puppeteer/Cheerio
crawling, `robots.txt` handling, Redis rate limiting/job state, AI enrichment, or Elasticsearch
storage yet**. `GET /api/search` is not implemented. These are deferred to later increments; the
sections below describe the eventual full scope, with notes marking what's already real.

## Tech Stack

- Backend: Node.js + TypeScript + Express + Prisma + PostgreSQL
- Redis: Rate limiting and temporary job state
- Elasticsearch: For storing and searching crawl results (future)
- Frontend: React (following Expense Tracker structure with Sidebar)
- Authentication: JWT

## 1. Database Models (Prisma) — implemented

`User.id` is a uuid `String` (already established by the auth feature), so `CrawlerJob.userId`
is `String`, not `Int` as originally sketched here. `CrawlSource`/`CrawlerJob`/`JobLog` themselves
use `Int` autoincrement PKs. `JobLog` was added (not in the original sketch below) because
CLAUDE.md's data model summary requires it and the "view execution logs" user story needs it.

```prisma
model CrawlSource {
  id                Int      @id @default(autoincrement())
  name              String   @unique
  baseUrl           String
  type              SourceType
  isActive          Boolean  @default(true)
  respectRobotsTxt  Boolean  @default(true)
  defaultDelayMs    Int      @default(2000)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

enum SourceType {
  STATIC     // Axios + Cheerio
  DYNAMIC    // Puppeteer
}

model CrawlerJob {
  id          Int       @id @default(autoincrement())
  userId      String    // FK to User.id (uuid)
  name        String
  description String?
  sources     Json      // array of source IDs
  keywords    String?   // for filtering
  config      Json      // { delayMs, maxDepth, usePuppeteer }
  status      JobStatus @default(PENDING)
  lastRunAt   DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  logs        JobLog[]
}

enum JobStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  STOPPED   // set by POST /jobs/:id/stop — distinct from FAILED (a real crawl error)
}

model JobLog {
  id        Int      @id @default(autoincrement())
  jobId     Int
  level     LogLevel @default(INFO)
  message   String
  createdAt DateTime @default(now())

  job CrawlerJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
}

enum LogLevel {
  INFO
  WARN
  ERROR
}
```

## 2. Predefined Sources (Seed Data) — implemented

Aligned with CLAUDE.md's Data Sources table (Habr Career / Moikrug / Craigslist), not the
SuperJob-inclusive list originally sketched here. Implemented as an idempotent upsert-by-`name`
seed script (`apps/api/prisma/seed.ts`, run via `npm run --workspace apps/api prisma:seed`):

- `Habr Career` — `https://career.habr.com` — `DYNAMIC` — 2500ms delay
- `Moikrug` — `https://moikrug.ru` — `STATIC` — 2000ms delay
- `Craigslist` — `https://craigslist.org` — `STATIC` — 1500ms delay

## 3. Redis Usage — deferred to a later increment

Not wired in Increment 1; the mock runner needs no queue or rate limiting. Keys schema for when
real crawling lands:

- Rate limiting: rate:domain:{domainName} (value: counter, TTL 60s)
- Job state: job:status:{jobId} (JSON with status, progress)
- Active job lock: job:active:{userId}:{jobId} (TTL = job timeout)

### 4. API Endpoints (Backend)

Sources — implemented (mounted at `/sources`, not `/api/sources`; the API has no `/api` prefix):

- GET /sources → list all available sources
- GET /sources/:id → source details

Jobs — implemented (mounted at `/jobs`):

- GET /jobs → user's jobs
- POST /jobs → create new job
- GET /jobs/:id → job details + logs
- POST /jobs/:id/start → start crawling (mock runner in Increment 1)
- POST /jobs/:id/stop → stop job (cancels the mock runner's pending timers)

Results — deferred (no Elasticsearch integration yet):

- GET /api/search → search in Elasticsearch (user-scoped)

## 5. User Flow (Frontend)

User logs in → sees Sidebar (Dashboard, Jobs, Sources, Profile)
Goes to Sources page → sees table of predefined sources with "Type" column (Puppeteer / Axios)
Goes to Jobs page → clicks "Create Job"

In form:

- Job name
- Multi-select sources
- Keywords input
- Optional config (delay, etc.)

Submits → job created (status PENDING)
User clicks "Start" → job moves to RUNNING, logs start appearing
User can view live logs and later search results

## 6. Implementation Steps

- [x] Implement Prisma models
- [x] Create backend controllers and services
- [x] Build React pages (Jobs + Sources)
- [ ] Integrate Redis for rate limiting (deferred — see §3)
- [ ] Replace the mock runner with real crawling (Axios/Cheerio + Puppeteer per `usePuppeteer`)
- [ ] AI enrichment + Elasticsearch storage + `GET /api/search`
