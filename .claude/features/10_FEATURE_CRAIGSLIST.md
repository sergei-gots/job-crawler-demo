# FEATURE: Craigslist Crawl Strategy (Increment 10)

## Overview

The last of the four seeded `CrawlSource` rows, `craigslist`, had no `CrawlStrategy` — triggering
a crawl for it (or "crawl all") logged a `WARN` and skipped, per the dispatch map in
`apps/api/src/crawler/index.ts`. This increment adds `craigslistStrategy.ts`, following
`habrCareerStrategy.ts`'s transport shape (Axios + Cheerio, JSON-LD detail-page parse) combined
with `weWorkRemotelyStrategy.ts`'s `CrawlListing`-required shape (craigslist has no single global
listing URL — every real target is a specific city's search page).

Unlike `remoteok`/`weworkremotely`, craigslist is a **general-purpose classifieds site**, not a
tech-only site by nature. This surfaced, for the first time, an implicit rule that every other
source had satisfied "for free": this app aggregates developer/tech vacancies specifically, not
vacancies in general. Making craigslist consistent with the rest of the app required an explicit
crawl-time filter (`cat=sof`, craigslist's own "software/qa/dba" category) rather than the site's
own scope doing the work. This rule is now stated explicitly in `CLAUDE.md`'s Data Sources section
and the `data-sources` skill, instead of remaining tribal knowledge inferred from source choices.

`crawlRunner.ts` needed no changes — confirms the `CrawlStrategy` abstraction generalizes to a
fourth, structurally different source without modification (same conclusion as Increments 4 and 6).

## Status

**Implemented** (2026-09-05). `apps/api` test suite passes (9 files, 38 tests, including the new
`craigslistStrategy.test.ts` and an updated `crawler/index.test.ts`).

## Decisions locked with the user

- **Project scope made explicit for the first time.** Every existing source was already
  implicitly developer/tech-vacancy-scoped (`habr_career` is a tech-only site by nature,
  `remoteok` is a tech job board, `weworkremotely`'s seeded categories are
  `remote-full-stack-programming-jobs`/`remote-back-end-programming-jobs`; the search facets
  `Specialization`/`Seniority` are IT-shaped concepts). `craigslist` is the first general-purpose
  classifieds source, so it's the first place this implicit agreement had to become an explicit
  filtering decision (`cat=sof`) rather than being free by the site's own nature. Added one
  explicit sentence to `CLAUDE.md`'s Data Sources section recording this as a standing rule for
  any future general-purpose source.
- **Axios + Cheerio, no Puppeteer** — confirmed live no Cloudflare challenge or CAPTCHA anywhere.
- **City-only `CrawlListing`s, no role/query dimension.** Considered a full city×role matrix
  (`query=backend` / `query=full+stack` on top of `cat=sof`) so `Specialization` could be chosen
  at crawl time instead of guessed during enrichment. Measured live that most city×role cells
  return 0-1 results (e.g. `newyork`+backend=0, `seattle`+backend=0, `losangeles`+backend=0) — a
  5×2 matrix would seed half-empty listings. Also checked `cat=sof` alone (no role split) and found
  real, recognizable dev-role titles already present ("Senior Full Stack Engineer", "Senior Full
  Stack Java Developer", "Computer Scientist / Full Stack Developer") with total measured volume
  (37 across 5 cities) well above the 5x2 split's total. Decision: city-only `CrawlListing`s
  (`{ label, subPath }`, no schema change), 5 rows — `sfbay`/`newyork`/`seattle`/`losangeles`/
  `chicago` (all `cat=sof`); `austin` checked and excluded for zero live results. Role
  (`Backend`/`Full-Stack`/etc.) is instead a `RawVacancy.specialization` field filled best-effort
  during `enrichDetails` via a keyword match on the vacancy's own title — not a hard requirement,
  not a separate `CrawlListing` axis.
- **`employmentType`** (present in the JobPosting JSON-LD) is out of scope — `RawVacancy`/the
  Elasticsearch schema has no field for it, and adding one is a cross-cutting schema-versioned
  change (see the `elasticsearch-conventions` skill) that shouldn't be bundled into this increment.
- **`maxVacanciesToCrawl` stays at the existing seeded default (25).** Inert for every seeded city
  today (max measured live volume is 11), but harmless — same "cap as ceiling, not guarantee"
  property as `remoteok`/`weworkremotely`.
- **`defaultDelayMs` stays at the already-seeded 11000ms** (matches `remoteok`/`weworkremotely`'s
  politeness level) — no evidence craigslist needs a different one.

## Spike findings (2026-09-05, against the live site)

- **robots.txt** (`https://www.craigslist.org/robots.txt`) only disallows `/reply`, `/fb/`,
  `/suggest`, `/flag`, `/mf`, `/mailflag`, `/eaf` — nothing blocks `/search/` or `/view/`. This
  reverses the `data-sources` skill's prior, never-actually-checked "expect rate-limiting or
  CAPTCHA under sustained automated access" caution — corrected in that skill doc as part of this
  increment.
- **No Cloudflare/CAPTCHA hit anywhere.** Listing and detail pages are both plain server-rendered
  HTML — confirmed via `curl` with a realistic desktop-Chrome UA, `200` on every request made.
- **Listing URL shape**: `https://www.craigslist.org/search/area/<citySlug>?cat=sof`. `sof` is
  craigslist's "software/qa/dba/etc" job category. `cat=jjj` (all jobs) was tried and rejected —
  too broad, dominated by restaurant/retail postings. Old-style `<city>.craigslist.org/search/sof`
  301-redirects to this `www.craigslist.org` form now.
- **Seed bug found and fixed**: the seeded `CrawlSource.baseUrl` was `"https://craigslist.org"`
  (bare apex) — confirmed this 404s on `/search/area/...` (the bare apex only serves a geo-redirect
  page at `/area/<country>`). Only `https://www.craigslist.org/...` (`200`) works. Corrected in
  `seed.ts`.
- **No pagination anywhere** on the listing page (no next-page link, no total-count element) —
  same "one-shot fetch bounded by `maxVacanciesToCrawl` truncation" situation as
  `weworkremotely`, not `habr_career`'s real page loop.
- **Per-city `cat=sof` counts measured live**: `sfbay`=11, `chicago`=10, `seattle`=7,
  `losangeles`=7, `newyork`=2, `austin`=0 (excluded). Per-city×role (`query=backend`/
  `query=full+stack`) counts were measured too and found mostly 0-1 (see Decisions above).
- **Listing row markup**: `<ol class="cl-static-search-results">`, each real row is
  `<li class="cl-static-search-result" title="...">` wrapping
  `<a href="https://www.craigslist.org/view/d/<slug>/<postToken>">` → `<div class="title">`,
  `<div class="details"><div class="price">$0</div><div class="location">...</div></div>`. The
  page's first `<li>` is `<li class="cl-static-hub-links">` ("see also" links, no matching detail
  link) — naturally excluded by selecting `li.cl-static-search-result` specifically. `$0` price is
  a boilerplate placeholder on every listing checked — not stored, same precedent as habr's dropped
  salary / remoteok's dropped `baseSalary`. `postToken` (e.g. `h4qi8Z4ZqSoYKXoguDQNEp`) is the
  unique URL segment, used as `externalId` — no numeric id exists on the listing page itself. No
  posting date is present anywhere on the listing page.
- **Detail page** (`.../view/d/.../<postToken>`) has a
  `<script type="application/ld+json">` block with `@type: "JobPosting"`, confirmed present on
  every real posting checked: `{ hiringOrganization: { name }, description: "<html with <br>>",
  employmentType, title, datePosted, jobLocation: { address: { addressLocality, addressRegion,
  ... } }, validThrough }`. No `jobLocationType`/TELECOMMUTE-style field exists anywhere — `isRemote`
  is deliberately left unset (`undefined`, not `null`/`false`), same "missing information isn't
  false" principle as `habrCareerStrategy`. `company` and `postedAt` are only available here, not
  on the listing page (unlike habr, where `postedAt` comes from the listing) — the listing pass
  sets both to `null`, and `enrichDetails`'s `Partial<RawVacancy>` patch fills them in via the same
  `{ ...vacancy, ...details }` merge habr already uses.

## Data model changes

None to the Prisma schema — reuses the existing `CrawlListing` model (Increment 9) as-is. Seed-data
only: `CrawlSource.baseUrl` corrected for Craigslist, and 5 new `CrawlListing` rows added. No
Elasticsearch schema change — `craigslistStrategy` populates only fields that already exist on
`RawVacancy`.

## Implementation plan

1. `apps/api/prisma/seed.ts`: fixed Craigslist's `baseUrl` → `"https://www.craigslist.org"`; added
   5 `CrawlListing` rows (`SF Bay Area`/`New York`/`Seattle`/`Los Angeles`/`Chicago`, all
   `/search/area/<city>?cat=sof`).
2. New `apps/api/src/crawler/strategies/craigslistStrategy.ts`: `parseCraigslistListing` (Cheerio,
   selects `li.cl-static-search-result`), `parseCraigslistVacancyDetail` (JobPosting JSON-LD parse,
   same `@type` filter approach as habr's `findJobPosting`), a `guessSpecialization` keyword-match
   helper, and the `craigslistStrategy` object (`crawl()` single-shot listing fetch + vacancy cap,
   mirroring WWR's shape; `enrichDetails()` per-vacancy fetch with 2-attempt retry, mirroring
   habr's loop exactly). Reuses `waitForSlot`, `getOrFetch`, `applyVacancyCap`, `upsertVacancy`,
   `htmlToText` unchanged.
3. New `apps/api/src/crawler/strategies/craigslistStrategy.test.ts` +
   `__fixtures__/craigslistListing.html`, `craigslistVacancyDetail.html`,
   `craigslistVacancyDetailNoJobPosting.html` — pure-function tests only, mirroring
   `habrCareerStrategy.test.ts`'s structure. Covers: valid-row parsing, the hub-links-row skip, a
   row missing its detail link, detail-JSON-LD field extraction (asserting `isRemote` is
   `undefined`, not `null`/`false`), and the no-JobPosting-block throw case.
4. `apps/api/src/crawler/index.ts`: registered `Craigslist: craigslistStrategy`; rewrote the header
   comment (previously said Craigslist "stays deferred").
5. `apps/api/src/crawler/index.test.ts`: replaced the "returns null" test's use of `"Craigslist"`
   (now a real strategy) with a fabricated name (`"Some Unimplemented Source"`); added a positive
   assertion that `getStrategy` returns `craigslistStrategy` for `"Craigslist"`.
6. Docs synced: `.claude/skills/data-sources/SKILL.md` (status flip, fetch-mechanism cell rewrite,
   the new explicit developer/tech-scope paragraph), `CLAUDE.md`'s Data Sources section (table row,
   intro paragraph, same explicit scope sentence), `apps/web/widgets/about/ui/about.tsx`'s
   description text.

## Verification (manual, per CLAUDE.md's Testing Philosophy)

- [x] `npm run test` inside `apps/api`: 9 test files, 38 tests, all passing.
- [ ] Re-run `prisma migrate deploy` (no-op, no schema change) and re-run the seed script; confirm
      the Sources page shows Craigslist with 5 selectable listings.
- [ ] Trigger a real crawl for the SF Bay Area listing (highest live volume, 11) via the UI;
      confirm the run completes, `CrawlLog` shows realistic listing/detail-fetch messages, and
      resulting vacancies in Search show `company`/`postedAt`/`description` populated, `isRemote`
      absent, and `specialization` populated where the title contains a matched keyword.
- [ ] Confirm the "see also" hub-links row never appears as a vacancy.
- [ ] Open the Craigslist source detail page's strategy diagram and confirm the 5 steps render with
      accurate text, no leftover "deferred"/"Not implemented yet" language anywhere in the UI.

## Out of scope

- Pagination — none exists on this listing page to support (see Spike findings).
- `employmentType` storage — deferred, see Decisions above.
- Craigslist categories other than `cat=sof`, or cities beyond the 5 seeded.
- A city×role `CrawlListing` matrix — considered and rejected for producing mostly-empty listings
  at today's live volume; `specialization` is a best-effort enrichment-time field instead.
