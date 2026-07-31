# FEATURE: Vacancy Detail Crawl (Increment 2.2)

## Overview

Builds on `.claude/features/02_FEATURE_REAL_CRAWLER_REDIS_ES.md` (Increment 2 — real habr_career
listing crawl, Redis, minimal Elasticsearch). That increment only fetched listing page(s) and
stored `title`/`company`/`url`/`postedAt`. This increment adds a second pass: for each vacancy
found on the listing, fetch its own detail page and pull richer fields into the same
Elasticsearch document.

**Goal**: after a listing crawl, `habr_career` vacancies also carry `description`, `location`,
`isRemote`, and `skillsSummary` in Elasticsearch — sourced from the detail page's own
`schema.org/JobPosting` structured data, not inferred or interpreted. AI enrichment (real skill
extraction/normalization, summarization, categorization) stays out of scope — see "Crawling vs.
AI Enrichment" below for where the line is drawn and why.

## Status

**Implemented** (Increment 2.2, commit `e6222b4`/`a6df20f`) — this doc's Status line was left
stale (still said "Planned") through the later Increment 3a crawl/search split; corrected
2026-07-31 to match the code, which has carried this since before 3a.

`description`, `location`, `isRemote`, `skillsSummary` are populated on `habr_career` vacancies
via `parseHabrVacancyDetail`/`enrichDetails` in
`apps/api/src/crawler/strategies/axiosCheerioStrategy.ts`, wired into the runner at
`apps/api/src/crawler/crawlRunner.ts:116`, and rendered on the source detail page
(`apps/web/widgets/source-detail/ui/source-detail-page.tsx`).

**Superseded by Increment 3a** (`.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md`): the
"Search" and "Data model changes" sections below still refer to the pre-3a `CrawlerJob` entity
and `queryVacanciesForJob`'s `multi_match`. That entity and its per-job keyword search no longer
exist — crawling is now triggered directly per `CrawlSource` (`POST /sources/:id/crawl`), and the
current `queryVacanciesForSource` (`apps/api/src/search/queryVacancies.ts`) is an age-filtered raw
feed for one source, with no keyword `multi_match` yet. A global keyword+facet search across all
sources (where a `description` field in `multi_match` would apply) is deferred to Increment 3b
per that doc — the "Keywords field semantics" and Create/Edit-job-form UI-hint items below never
landed and don't apply to the current UI (there's no per-job keyword field anymore).

## Post-3a bug: Stop can leave the Vacancies panel showing a stale snapshot (found and fixed 2026-07-31)

**Symptom**: user reported seeing fewer enriched fields (missing `isRemote` etc.) on
`/sources/:id` than expected, on a vacancy that (per direct ES inspection) *was* actually
enriched.

**Investigation** (direct queries against the running ES/Postgres containers, not just code
reading):
- First hypothesis (wrong, corrected): assumed the underlying two runs had simply been stopped
  before `enrichDetails` ever started. True for that specific earlier case (`crawl_runs` ids
  50/51 — `runState.cancelled` flipped true before the `!runState.cancelled` guard at
  `crawlRunner.ts:116` was reached, so `enrichDetails` never ran for those runs at all), but not
  what was happening on the next reproduction.
- Second reproduction: `CrawlLog` showed `enrichDetails` running normally and reaching vacancy
  8/25 before "Stopped by user". Direct ES lookup of the specific vacancy the user had copy-pasted
  (`3:1000166920`) showed it **was** fully enriched, with `lastSeenAt` **7 seconds after** the
  "Stopped by user" log line — i.e. the enrichment for that vacancy completed, just after the
  page snapshot the user was looking at had been taken.
- **Root cause**: a frontend race, not a crawler bug. `stopSourceCrawl`
  (`apps/api/src/sources/sources.service.ts:65`) flips `CrawlRun.status` to `STOPPED`
  synchronously and returns immediately — it does not wait for the background task
  (`executeCrawlRun`) to finish whatever single detail fetch was already in flight (cooperative
  cancellation only stops the *next* iteration from starting, per the "must remain responsive"
  decision earlier in this doc — deliberately not changed, see below). The frontend
  (`source-detail-page.tsx`'s `onStopped` handler) treated the `STOPPED` status as "fully
  settled" and fired exactly one `loadVacancies()` refresh right on that transition — which can
  race the still-in-flight write (up to roughly `source.defaultDelayMs` + the request's own
  latency, e.g. ~12-30s for `habr_career`) and miss it. Since the RUNNING poll loop
  (`source-detail-page.tsx`, `useEffect` gated on `run?.status === "RUNNING"`) stops as soon as
  status leaves `RUNNING`, nothing ever refetches again — the stale snapshot stays on screen
  until a manual page reload.

**Fix applied** (`apps/web/widgets/source-detail/ui/source-detail-page.tsx`): a second `useEffect`
gated on `run?.status === "STOPPED"` schedules one delayed follow-up `loadRun()` +
`loadVacancies()`, sized to `source.defaultDelayMs + 10000`ms, cleaned up (`clearTimeout`) if the
status changes again first (e.g. a new run starts) or the component unmounts. Deliberately
**not** fixed by making the backend's `stopSourceCrawl` block/await the background task before
returning (e.g. via the existing `waitUntilNotCrawling` helper already used by
`clearSourceData`) — that would make the Stop button itself feel unresponsive for up to ~30s,
directly contradicting the "Stop action must remain responsive" decision already locked in this
doc's "Scope decisions locked with the user" section. The fix stays purely client-side: Stop
still returns instantly, the UI just knows to check again once the trailing write has had time to
land.

## Considered and rejected: clearing a source's ES data before every crawl restart

Raised by the user while investigating the above (**"should a source restart clear all of that
source's existing ES data first?"**) — considered and rejected, not implemented:

- **Why it looks appealing**: would guarantee no stale-looking leftover data from a previous run.
- **Why it's wrong**: `CrawlerResultDoc`s are deduplicated by `sourceId:externalId` and
  accumulate *across* runs by design (`CLAUDE.md`'s data model) — this is what lets a source's
  visible corpus exceed what any single run's `maxPagesToCrawl` budget covers (e.g. `habr_career`
  at 1 page = 25 vacancies per run today). A vacancy seen on page 2 of an earlier run but not
  present on page 1 of the current run's page budget is still a real, live vacancy — clearing on
  restart would delete it just because pagination didn't re-surface it this time, permanently
  capping the visible corpus at one run's page budget instead of letting it converge toward full
  coverage over multiple runs.
- **The staleness problem this would try to solve is already handled correctly, just
  gradually**: `queryVacanciesForSource` (`apps/api/src/search/queryVacancies.ts`) filters by
  `MAX_VACANCY_AGE_DAYS` (14 days default) against `lastSeenAt` — a vacancy that stops being
  re-seen ages out of results on its own, without an all-or-nothing wipe.
- **A wipe is already available as an explicit, separate action** — the "Clear data" admin
  button (`clearSourceData`) — for when the user genuinely wants to reset a source. Auto-clearing
  on every restart would make that action redundant and remove the user's ability to choose.
- **Decision: no change** — a crawl restart stays a pure upsert against the existing corpus, as
  it is today.

## Naming note

Earlier drafted as "Vacancy Detail *Enrichment*" — renamed to **"Vacancy Detail *Crawl*"** to
avoid colliding with `CLAUDE.md`'s existing, separate "AI enrichment" term (`MockAIEnricher` /
`ClaudeEnricher`, Claude API summarization/skill-extraction/categorization). This increment adds
no AI — it is a second, deeper crawl pass over data the source itself already published.

## Per-source scope — habr_career only

Everything below (JSON-LD parsing, the specific fields available, the "no salary" finding) is
**specific to `habr_career`'s detail-page markup**. It lives entirely inside
`apps/api/src/crawler/strategies/axiosCheerioStrategy.ts`, behind the same `CrawlStrategy`
abstraction already used for the listing crawl. When a future source (RemoteOK, WeWorkRemotely,
Craigslist) gets its own `CrawlStrategy`, it will need its own detail-page investigation — a
different site structure, different available fields (e.g. RemoteOK already exposes structured
skill tags per its `CLAUDE.md` note, unlike habr's sentence-shaped summary), and possibly no
detail-crawl step at all if the listing already has everything. The Elasticsearch document shape
(`CrawlerResultDoc`) is source-agnostic and shared; only the extraction logic is per-source.

## Spike findings (this session, read-only `curl` against real habr_career pages)

Fetched 8 real vacancy detail pages (`career.habr.com/vacancies/{numeric_id}`) plus 3 listing
pages (~150 cards) for statistical checks.

- **`<script type="application/ld+json">` containing a `schema.org/JobPosting` object exists on
  every detail page tested (8/8).** This is far more robust than scraping ad-hoc CSS classes —
  it's the same structured markup habr exposes for Google Jobs indexing, unlikely to break on
  frontend redesigns. Fields present: `title`, `description` (HTML string), `identifier.value`
  (matches the listing's numeric external id), `hiringOrganization.name`, `jobLocation[].address`,
  `jobLocationType` (`"TELECOMMUTE"` when remote), `employmentType`, `datePosted`, `validThrough`.
  Fields schema.org supports but habr does **not** populate: `baseSalary`, `skills`.
- **Salary is essentially never disclosed.** Checked ~150 listing cards across 3 pages — **100%**
  showed `"Зарплата не указана"` ("salary not specified") at the actual salary field. The only
  visible number (`"Похожие специалисты получают 276 000 – 400 000 ₽"`) is a **market estimate
  for similar roles**, not the employer's stated salary for that vacancy — storing it as `salary`
  would misrepresent the source. **Decision: salary is dropped from scope entirely**, not
  approximated from this estimate.
- **The lead sentence of `description` is a stable, site-generated template — 8/8 samples
  matched it:** `"Навыки: A, B, C. [Квалификация: X.] Специализации: Y."` — auto-generated by
  habr from the employer's own structured tag selections at posting time. Because the format was
  consistent across the full sample, extracting this sentence counts as **crawling** (parsing a
  known, site-generated template), not AI interpretation of free text.

## Crawling vs. AI Enrichment — the line drawn this session

- **Crawling** = extracting what the source already explicitly published, deterministically, with
  no interpretation. Applies to `description`, `location`, `isRemote`, and `skillsSummary` below —
  all are literal fields or a literal, stable-template sentence already present in the page's own
  structured data.
- **AI Enrichment** (future, separate increment, per `CLAUDE.md`'s `MockAIEnricher`/
  `ClaudeEnricher`) = anything requiring interpretation beyond the literal page content:
  splitting `skillsSummary`'s free-form comma list into a normalized, deduplicated skill array;
  extracting skills from vacancies whose source has no structured tags at all; semantic/fuzzy
  matching of a job's keywords against a vacancy's skills (e.g. "Node.js" ≈ "JavaScript backend");
  summarization; categorization.
- `skillsSummary` is stored as an **opaque raw string**, not split into an array — splitting would
  be the first step of interpretation (deciding what counts as one skill, how to handle the
  embedded "Квалификация"/"Специализации" clauses) and is deliberately left for the AI Enrichment
  increment, if pursued.

## Scope decisions locked with the user

- **Fields added**: `description` (plain text, HTML tags stripped via `cheerio.load(html).text()`
  — not stored/rendered as HTML, since the UI has no HTML-sanitizing renderer today), `location`
  (from `jobLocation[].address`), `isRemote` (boolean, `jobLocationType === "TELECOMMUTE"`),
  `skillsSummary` (raw lead sentence of `description`, only if it matches the `"Навыки:"` prefix
  pattern, else `null`).
- **No `salary` field** — see spike findings above.
- **No skill-array splitting** — see Crawling vs. AI Enrichment above.
- **Detail pages go through the existing Redis infra** — same `waitForSlot`/`getOrFetch` as the
  listing crawl, keyed the same way (`sourceId`, page URL). No new rate-limiting or caching
  mechanism.
- **No separate cap on detail fetches.** Earlier drafts of this document proposed a limit
  (first a global `MAX_DETAIL_FETCHES_PER_RUN` env var, then a per-source
  `maxDetailFetchesPerRun` column mirroring `maxPagesPerRun`) to bound how many vacancies get a
  detail-page fetch per run. **Rejected after discussion**: any cap below the listing's total
  creates a "ragged data" problem — the same first-N vacancies get detail-enriched on every run
  while the rest never do, unless a real backlog/rolling-selection mechanism is added to
  eventually converge on full coverage. That mechanism was judged unnecessary complexity for an
  MVP demo. **Final decision: `enrichDetails` fetches every vacancy found in the current listing
  pass — no cap at all.** The volume is already bounded by the existing `maxPagesPerRun` (e.g. 3
  pages × 25 = 75 vacancies today for `habr_career`). Detail requests share the existing
  per-source rate limiter (`rate:source:{sourceId}`, `defaultDelayMs` — seeded at 12000ms for
  `habr_career`), so a full run at `maxPagesPerRun = 3` takes roughly (3 + 75) × 12s ≈ 15
  minutes. **This is intentional**: the user explicitly prioritized crawling safety/politeness
  (respecting the source's rate limit) over run speed. If a faster demo loop is wanted later, the
  lever is the existing `maxPagesPerRun` (lower it), not a new detail-specific cap.
- **Per-vacancy failures are non-fatal**: if a detail page fails to fetch/parse, log a `WARN` and
  continue to the next vacancy — matches the existing per-source error handling in the runner.
- **Cooperative cancellation extends to the detail-fetch loop**, not just between sources — a
  crawler job's `Stop` action must remain responsive even while enriching 15 vacancies one by one.
- **Search**: `description` is added to the existing `multi_match` fields in
  `queryVacanciesForJob` (`["title", "company"]` → `["title", "company", "description"]`) —
  extends the current per-job keyword filter to match text in the vacancy body, not just
  title/company. No change to the OR-based matching behavior (see below).
- **Keywords field semantics — documented, not changed.** `CrawlerJob.keywords` is passed whole
  into an Elasticsearch `multi_match`, which defaults to **OR** semantics (matches vacancies
  containing *any* of the words, not all of them) — e.g. `"docker, kubernetes"` matches vacancies
  mentioning either word, not necessarily both. This was already true before this increment but
  becomes more visible once `description` is searched too. Decision: **keep OR semantics**
  (broader net is the right default for a job search use case; full Coveo-like facet control is
  already deferred per `CLAUDE.md`) but **add a UI hint** so the behavior isn't a surprise:
  *"Matches any of these words in the vacancy's title, company, or description"* as a small
  `text-xs text-muted-foreground` line under the Keywords input, in both the Create and Edit forms.

## Data model changes

- No Prisma schema change (no new cap column — see decision above).
- `apps/api/src/crawler/types.ts` — `RawVacancy` gains optional fields:
  `description?: string | null`, `location?: string | null`, `isRemote?: boolean | null`,
  `skillsSummary?: string | null`. Listing-only strategies simply omit them (`undefined`).
- `apps/api/src/search/crawlerResultsIndex.ts` — mapping gains:
  `description: { type: "text" }`, `location: { type: "text" }`, `isRemote: { type: "boolean" }`,
  `skillsSummary: { type: "text" }`.
- `apps/api/src/search/upsertVacancy.ts` — no signature change needed; it already does a partial
  `doc` update (not a full replace), so calling it a second time per vacancy — once from the
  listing pass (existing fields only), once from the detail-crawl pass (adding the new fields) —
  merges correctly without touching `firstSeenAt`.

## Implementation plan

### 1. `apps/api/src/crawler/strategies/axiosCheerioStrategy.ts`
- Add a `parseHabrVacancyDetail(html, source): Partial<RawVacancy>` function: `JSON.parse()` the
  `<script type="application/ld+json">` contents, map `description` (HTML → `cheerio.load(...)
  .text().trim()`), `location` (`jobLocation?.[0]?.address ?? null`), `isRemote`
  (`jobLocationType === "TELECOMMUTE"`), `skillsSummary` (first `<p>` of the raw HTML
  description, only kept if it starts with `"Навыки"`, else `null`).
- Add an `enrichDetails` step, exposed as an optional method on `CrawlStrategy`
  (`enrichDetails?(source, vacancies, isCancelled): Promise<{ enrichedCount: number; warnLogs:
  string[] }>`) so sources without a detail-crawl implementation simply don't have it — the
  runner checks for its presence, mirroring how `getStrategy` already returns `null` for
  unimplemented listing crawlers.
- Inside `enrichDetails`: iterate **all** vacancies from the listing result (no cap); for each,
  check `isCancelled()` before proceeding; `getOrFetch` + `waitForSlot` the detail page URL (same
  infra as listing); parse via `parseHabrVacancyDetail`; call `upsertVacancy` with the merged
  fields; call `logProgress` **once per vacancy** (not batched) — "enriched vacancy i/N (cache:
  hit/miss): {title}" on success, or a `WARN`-level line on failure, then continue to the next
  vacancy. Per-vacancy logging matters here specifically because a run can take several minutes
  (see the rate-limit note above) — without it, `JobLog` would go silent for that whole stretch.

### 2. Runner (`apps/api/src/crawler-jobs/crawler-jobs.runner.ts`)
- After the existing listing crawl + upsert loop for a source, if `strategy.enrichDetails`
  exists: `JobLog` "Enriching vacancy details for {source.name} ({N} vacancies)", call it with the
  existing cooperative-cancellation flag check plus a `logProgress` callback wrapping
  `logInfo`/`logWarn`, then `JobLog` "Enriched {enrichedCount}/{N} vacancies for {source.name}"
  once the loop completes.

### 3. Search
- `apps/api/src/search/queryVacancies.ts` — extend `queryVacanciesForJob`'s `multi_match` fields
  to `["title", "company", "description"]`.

### 4. Frontend
- `apps/web/features/create-crawler-job/ui/create-job-form.tsx` and
  `apps/web/features/edit-crawler-job/ui/edit-job-form.tsx` — add a `text-xs
  text-muted-foreground` hint line under the Keywords `Label`/`Input`: *"Matches any of these
  words in the vacancy's title, company, or description."*
- `apps/web/widgets/crawler-job-detail/ui/crawler-job-detail-page.tsx` — optionally show
  `description` (short preview) and `location`/`isRemote` in the Vacancies card. Ask before
  building this — API/data changes are the priority; UI polish can follow once verified.

### 5. Docs
- `README.md` — add a short note under the habr_career source description: detail pages are now
  also crawled for `description`/`location`/`isRemote`/`skillsSummary`, salary is intentionally
  not collected (rarely disclosed by the source, and the visible number is a market estimate, not
  the actual offer), the Keywords field's OR-matching behavior, and that a full run can take
  several minutes by design (12s per-request rate limit, no cap on detail fetches).
- `CLAUDE.md` — no changes expected beyond what's already documented (per-source `CrawlStrategy`
  pattern already covers this); revisit only if implementation reveals a new convention worth
  recording.

## Verification (manual, per `CLAUDE.md`'s Testing Philosophy)

- Start a crawler job against `habr_career`; confirm `JobLog` shows both the existing listing
  progress lines and new "Enriching vacancy details..." / "Enriched N/N vacancies" lines (N
  should equal the total vacancies found across all listing pages, not a truncated subset).
- `GET /crawler-jobs/:id/vacancies` (or `GET /sources/:id/vacancies`) shows `description`,
  `location`, `isRemote`, `skillsSummary` populated for **all** returned vacancies (no partial
  coverage by design).
- Confirm no `salary` field appears anywhere in the stored documents.
- Stop a running crawler job while it's in the middle of the detail-fetch loop — confirm it
  actually stops promptly instead of finishing all pending detail fetches first.
- Force one detail-page fetch to fail (e.g. a since-removed vacancy id) — confirm a `WARN`
  `JobLog` line appears and the run still reaches `COMPLETED`.
- Create/edit a crawler job with keywords like `"docker, kubernetes"` — confirm the hint text
  appears under the field, and confirm (via `GET /crawler-jobs/:id/vacancies`) that a vacancy
  matching only one of the two words is still returned (OR semantics, not AND).

## Implementation steps

- [x] Extend `RawVacancy` type with optional detail fields.
- [x] Extend `CrawlerResultDoc` / index mapping with the new fields.
- [x] Implement `parseHabrVacancyDetail` + `enrichDetails` in `axiosCheerioStrategy.ts`.
- [x] Wire `enrichDetails` into the runner, with progress logs and cooperative cancellation
      inside the detail-fetch loop (now `crawlRunner.ts`, post-3a).
- [ ] ~~Extend `queryVacanciesForJob`'s `multi_match` fields to include `description`.~~ N/A —
      `CrawlerJob`/`queryVacanciesForJob` no longer exist post-3a; global keyword search over
      `description` is deferred to Increment 3b (`03_FEATURE_CRAWL_SEARCH_SEPARATION.md`).
- [ ] ~~Add the Keywords OR-matching hint text to Create and Edit forms.~~ N/A — those forms
      (per-`CrawlerJob` keywords) no longer exist post-3a.
- [x] Update `README.md` with the habr_career detail-crawl note (salary intentionally omitted,
      run duration) — see "Vacancy detail crawl — Increment 2.2" section.
- [x] Manual verification per the checklist above (confirmed working on `/sources/:id`).
