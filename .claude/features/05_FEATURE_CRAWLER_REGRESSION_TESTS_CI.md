# FEATURE: Crawler Regression Tests + CI (Increment 5)

## Overview

Increment 4 shipped a second, structurally different `CrawlStrategy` (Puppeteer/RemoteOK) on top
of the first (Axios+Cheerio/habr_career), and in reviewing the project honestly afterward, the
clearest gap was: every parsing decision so far had been verified by hand against the live site or
via one-off spikes — real verification, but not *repeatable* verification. If either site changes
its markup, or a future edit to a parser introduces a bug, nothing catches it except a human
noticing vacancy counts look wrong days later.

**Goal**: add regression coverage for the parts of the crawler that are both most fragile
(site-markup-dependent parsing) and cheapest to test in isolation (pure functions, no network/DB),
consistent with CLAUDE.md's Testing Philosophy ("manual testing is primary; automated tests added
later for critical paths"). Then wire CI so these tests actually run on every push/PR — a suite
nobody runs automatically isn't regression protection.

## Status

**Implemented and verified** (2026-08-08). `npm run test`/`lint`/`typecheck` all pass from the repo
root via `--workspace apps/api` (the same invocation form CI uses), run twice in a row with
identical results (27 tests, 6 files, no cross-test state leakage). `prisma generate` (a
prerequisite for `@prisma/client`'s generated types, which `CrawlSource`/`RawVacancy` depend on)
confirmed to work with no `.env`/`DATABASE_URL` present, so CI needs no database service or
secrets.

## Decisions locked with the user

- **CI**: `.github/workflows/ci.yml` runs `npm ci`, `prisma:generate`, lint, typecheck, and
  `vitest run` for `apps/api` on every push to `main` and every pull request. Explicitly asked and
  confirmed — this is what turns the new tests into enforcement rather than an opt-in local habit.
- **Scope: parsing logic + `upsertVacancy`'s field-merge logic, not the runner.** `crawlRunner.ts`
  (status transitions, cancellation, `CrawlLog` writes) has had real bugs before (Increment 2.2's
  doc records a slot-release-on-crash bug and a frontend stale-snapshot race) and is not low-value
  to test, but needs Prisma+Redis+strategy mocking to exercise in isolation — a bigger lift than
  this pass. Flagged as a follow-up, not built now.
- **No live-network or live-Puppeteer tests.** All new tests run against small hand-built HTML
  fixtures — testing against the real sites would be slow, flaky, and exactly the kind of repeated
  external-request pattern the project has otherwise been careful to avoid.
- **Minimal refactor for testability, no behavior change**: `parseHabrCareerPage` and
  `parseHabrVacancyDetail` (in `habrCareerStrategy.ts`) and `parseListingPage` (in
  `remoteOkStrategy.ts`) were module-private; they're now `export`ed so tests call them directly
  instead of mocking `axios`/`puppeteer` just to reach pure parsing code.

## Data model changes

None.

## Implementation plan

1. `apps/api/src/crawler/htmlToText.test.ts` — already-exported pure function, no refactor needed.
   Covers plain-text passthrough, `<br>`→newline, block-tag-close→newline, 3+ newline collapsing,
   empty/whitespace→`null`.
2. `apps/api/src/crawler/strategies/habrCareerStrategy.ts` — exported `parseHabrCareerPage` and
   `parseHabrVacancyDetail`. New fixtures under `strategies/__fixtures__/`:
   `habrCareerListing.html` (a normal card plus one missing its vacancy href/title, to exercise the
   skip guard), `habrCareerVacancyDetail.html` (well-formed `JobPosting` JSON-LD with the
   `"Навыки: ... Квалификация: ... Специализации: ..."` lead sentence),
   `habrCareerVacancyDetailNoJobPosting.html` (no parseable JobPosting block, to confirm the
   documented throw-and-skip contract). New `habrCareerStrategy.test.ts` (3 tests).
3. `apps/api/src/crawler/strategies/remoteOkStrategy.ts` — exported `parseListingPage`. New fixture
   `remoteOkListing.html` with four `tr.job` rows: one clean (well-formed JSON-LD), one with a
   deliberately malformed JSON-LD block (unterminated string, mirroring the real ~1-in-4 case found
   during the Increment 4 spike) to confirm graceful `description: null` fallback rather than a
   thrown error, one with tags duplicated in the DOM (desktop/mobile layout variants) to confirm
   deduping, one missing `data-id` to confirm the skip guard. New `remoteOkStrategy.test.ts`
   (5 tests).
4. `apps/api/src/crawler/index.test.ts` — `getStrategy()` returns the right strategy for
   `"Habr Career"`/`"RemoteOK"` and `null` for unrecognized names (`"WeWorkRemotely"`,
   `"Craigslist"`) — cheap insurance on the dispatch map refactored in Increment 4 (3 tests).
5. `apps/api/src/search/upsertVacancy.test.ts` — follows `suggestVacancies.test.ts`'s exact
   convention (`vi.mock` with a hoisted `vi.fn()`, dynamic import-after-mock). Asserts the
   `sourceId:externalId` id format, that absent detail fields are omitted entirely (not written as
   `null`), that an explicit `null` (source genuinely has no value) is preserved distinct from
   omission, that present fields land on both `doc` and `upsert`, and that `firstSeenAt` only
   appears on the `upsert` branch (5 tests).
6. `.github/workflows/ci.yml` (new): `actions/checkout` + `actions/setup-node` (Node 24), `npm ci`
   at the repo root (workspaces hoist `node_modules` there), `npm run prisma:generate --workspace
   apps/api`, then `lint`/`typecheck`/`test` the same way, all via `--workspace apps/api` from the
   root rather than `cd`-ing in. No Postgres/Redis/ES services — nothing in the new or existing
   test suite touches them, and `prisma generate` only reads `schema.prisma`, it doesn't connect.
7. `README.md`: new "Automated regression tests + CI — Increment 5" section; a forward-pointer note
   added to the existing Increment 3c paragraph that first mentioned `suggestVacancies.test.ts`.

## Explicitly out of scope

- Testing `crawlRunner.ts`'s orchestration (status transitions, cancellation, `CrawlLog` writes).
- Testing `rateLimiter.ts`/`pageCache.ts` against a real or mocked Redis.
- Any live-network or live-Puppeteer-driven test.
- Expanding `queryVacancies.ts`/facet coverage beyond what `suggestVacancies.test.ts` already has.
- A dedicated `vitest.config.ts` — current defaults are sufficient (no DOM needed; Cheerio doesn't
  require jsdom).

## Verification

- [x] `npm run test/lint/typecheck --workspace apps/api` (from repo root, matching CI's invocation
      form) all pass; test suite run twice back-to-back with identical results (27/27, 6 files).
- [x] `prisma generate` confirmed to succeed with `apps/api/.env` temporarily removed, proving CI
      needs no `DATABASE_URL`/secrets/database service for these steps.
- [ ] Push the branch and confirm the GitHub Actions workflow actually runs and goes green on the
      resulting PR — the real test of "automatic," since a local pass doesn't confirm the workflow
      YAML/trigger wiring is correct.
