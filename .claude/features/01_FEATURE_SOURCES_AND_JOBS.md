# FEATURE: Sources Management and User Profile

## Overview

This doc originally (Increment 1) described a `CrawlerJob` CRUD entity — per-user, keyword-filtered
crawl jobs backed by a mock runner. That design was fully replaced in Increment 3: crawling now
runs directly on `CrawlSource` (`CrawlRun`, not `CrawlerJob`), and keyword filtering moved to the
Search page. See `03_FEATURE_CRAWL_SEARCH_SEPARATION.md` for that redesign and its rationale.

This doc is kept short and current-state-only: what a user can actually do today around Sources
and their own account. It intentionally does not restate forward-looking scope or deferred-work
lists — those live in the increment docs that actually implemented them
(`02_FEATURE_REAL_CRAWLER_REDIS_ES.md`, `02b_FEATURE_VACANCY_DETAIL_CRAWL.md`,
`03_FEATURE_CRAWL_SEARCH_SEPARATION.md`, `04_FEATURE_PUPPETEER_REMOTEOK.md`).

## Status: Implemented

### Sources & crawling

- `CrawlSource` (Prisma/PostgreSQL) — seeded, not user-created (`apps/api/prisma/seed.ts`).
- `GET /sources`, `GET /sources/:id` — list/detail.
- `POST /sources/:id/crawl`, `POST /sources/:id/crawl/stop` — start/stop a crawl for one source.
- `POST /sources/crawl-all` — start a crawl for every source that has a `CrawlStrategy`.
- `GET /sources/:id/run` — latest `CrawlRun` for a source, including its `CrawlLog[]`.
- `GET /sources/:id/vacancies` — vacancies collected for that source.
- Crawling is global/shared, not owned per user — any authenticated user can start/stop any
  source's crawl (see Security Considerations in `CLAUDE.md`).
- Real crawling (Axios+Cheerio for `habr_career`, Puppeteer for `remoteok`) is implemented per
  `CrawlStrategy` — see `02_FEATURE_REAL_CRAWLER_REDIS_ES.md` and `04_FEATURE_PUPPETEER_REMOTEOK.md`.

### User profile

Not covered by any earlier feature doc — documented here for the first time:

- `PATCH /users/me` — update `name`/`email`, requires `currentPassword` in the request body to
  confirm the change (`apps/api/src/users/users.controller.ts` → `updateProfile` in
  `users.service.ts`).
- `PATCH /users/me/password` — change password, requires `currentPassword` (`changePassword` in
  `users.service.ts`).
- Frontend: `/profile` page (`apps/web/widgets/profile/ui/profile-page.tsx`) — an "Account
  details" card (`UpdateProfileForm`) and a separate "Change password" card
  (`ChangePasswordForm`), per the UI Design Guidelines in `CLAUDE.md` (separate cards, not a
  divider).
- **Not implemented**: account deletion — there is no `DELETE /users/me` endpoint and no UI for
  it. A user who registers has no way to remove their account.

## Tech Stack

Unchanged from the rest of the project — see `TECH_STACK_OVERVIEW.md` /
`.claude/doc/TECH_STACK_OVERVIEW.md`. Not repeated here since it's identical for every feature doc
in this project.
