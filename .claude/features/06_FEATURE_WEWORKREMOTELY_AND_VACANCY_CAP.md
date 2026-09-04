# FEATURE: WeWorkRemotely Crawl Strategy + Vacancy-Count Cap + Drop Dead CrawlSource Fields (Increment 6)

## Overview

Three coupled pieces of work, done in that order because each later one was written directly
against the previous rather than migrated onto it afterward:

1. **Replaced `CrawlSource.maxPagesToCrawl`/`supportsPageLimit` with a single
   `maxVacanciesToCrawl` field**, applied inside every strategy's `crawl()`. The old field only
   ever made sense for a source with real page-based pagination (`habr_career`); RemoteOK already
   needed a `supportsPageLimit: false` escape hatch to hide/ignore it, and WeWorkRemotely would
   have needed the same. Rather than grow a second parallel field, the two were merged into one,
   expressed in the unit that's meaningful for every source (vacancy count, not page count).
2. **Added the third real `CrawlStrategy`: `weworkremotely`**, Puppeteer for the listing pass
   (Cloudflare-gated, same precedent as RemoteOK) followed by an RSS-feed-based enrichment pass —
   not a second round of Puppeteer detail-page fetches like `habr_career`'s two-level shape. The
   RSS design was a mid-implementation pivot: the original plan mirrored habr exactly (Puppeteer
   for both listing and detail), but a live verification run found that approach unreliable in
   practice — see Decisions locked with the user, and Spike findings, below.
3. **Removed `CrawlSource.type` (`STATIC`/`DYNAMIC`) entirely.** A design-review conversation
   during this increment (prompted by `type` having gone stale for `weworkremotely` earlier in
   this very increment, unnoticed until a live re-check) found `type` was read in exactly one
   place in the whole codebase — a UI tooltip — and wasn't consumed by dispatch or any crawl
   logic at all (dispatch is by `CrawlSource.name`; each strategy file hardcodes its own fetch
   library regardless of what `type` says). Since the fact it recorded was already fully and
   solely determined by the strategy file's own code, storing a second copy in the database was
   structurally guaranteed to drift eventually, with nothing to catch it when it did. Replaced
   with a `description: string` field directly on each `CrawlStrategy` object, read at API
   response time via `getStrategy(source)?.description` — there is now only one copy of this
   fact, living in the same file (often the same edit) as the code it describes.

`crawlRunner.ts` needed **no changes** for any of the three pieces — the cap is enforced inside
each strategy's own `crawl()`, and dispatch/response-shaping changes live entirely in
`sources.service.ts`/`sources.controller.ts` and the strategy files themselves.
`crawlRunner.ts` was already strategy-agnostic (see `04_FEATURE_PUPPETEER_REMOTEOK.md`),
confirming the abstraction generalizes to a third, structurally different source without
modification.

## Status

**Implemented and manually verified** (2026-09-04). Migration applied, seed re-run, `apps/api`
test suite passes (34/34), `tsc --noEmit` clean in both apps. Triggered real crawls against the
live stack:

- Habr Career, `maxVacanciesToCrawl: 3`: `RUNNING` → `COMPLETED`, page loop stopped after page 1
  ("reached maxVacanciesToCrawl (3) - stopping early"), exactly 3 vacancies stored, all 3
  successfully detail-enriched.
- WeWorkRemotely, `maxVacanciesToCrawl: 5` (initial Puppeteer-detail-fetch design): `COMPLETED`,
  listing found 120 rows, truncated to 5, but only **1/5** detail fetches succeeded — see Spike
  findings for why, and the pivot this triggered.
- WeWorkRemotely, `maxVacanciesToCrawl: 25`, after pivoting `enrichDetails` to the RSS feed:
  `COMPLETED`, **25/25** vacancies enriched, real `description`/`location`/`isRemote`/`postedAt`
  (and `skillsSummary` where the feed's `<skills>` tag was non-empty) confirmed in Elasticsearch.
- Source detail page UI checked visually for both sources: "Vacancies to crawl" field always
  shown (no "Not applicable" branch), correct values, `DYNAMIC`/`STATIC` type labels correct.

## Decisions locked with the user

- **`maxVacanciesToCrawl`, not `maxRecordsToCrawl`.** Considered both; picked `Vacancies` for
  consistency with this codebase's existing vocabulary (`RawVacancy`, `upsertVacancy`,
  `CrawlRun.vacanciesFound`, and the Source detail page's existing "Vacancies" section from PR
  #21) — `Records` would have been a new, unrelated term with no other precedent in the codebase.
- **Replace, not add alongside.** An earlier idea was to keep `maxPagesToCrawl` and derive a new
  `maxVacanciesToCrawl` from it via a flat `× 25` multiplier. Rejected: the multiplier isn't
  universal (habr's real pagination returns a variable number of cards per page, not a fixed 25),
  and for RemoteOK/WeWorkRemotely there's no page concept to multiply in the first place — both
  return every listing row in one shot regardless of any page number. One field, one unit,
  applied uniformly, was simpler and correct for all four sources at once.
- **`supportsPageLimit` removed outright, not renamed.** It only ever existed to hide the
  page-count field for sources without real pagination. A vacancy-count cap is meaningful for
  every source (habr stops its page loop early; RemoteOK/WeWorkRemotely truncate their single
  listing fetch), so there's nothing left to hide — the Source detail page's "Vacancies to crawl"
  field is now always shown, no conditional/"Not applicable" branch.
- **habr's cap is enforced by stopping the page loop early, not by truncating after the fact.**
  Explicitly called out by the user: fetching further pages whose extra rows would just be
  discarded defeats the purpose of a cap that exists partly to bound request/Puppeteer cost.
  RemoteOK/WeWorkRemotely, which fetch everything in one shot, have nothing to stop early — they
  truncate the single parsed batch instead.
- **Default `25`**, not `1` (the old `maxPagesToCrawl` default) — confirmed with the user, sized
  to keep a WeWorkRemotely `enrichDetails` run (Puppeteer per vacancy, ~11s rate limit each) under
  ~5 minutes rather than the 20+ minutes an uncapped ~120-row listing would cost.
- **Listing goes through Puppeteer; enrichment goes through the RSS feed — not two rounds of
  Puppeteer.** The original design put both the listing AND every detail-page fetch through
  Puppeteer (mirroring habr's shape, with RemoteOK's transport). That version was actually built
  and run against the live site first: the listing fetch worked reliably (120/120 rows every
  time), but the per-vacancy Puppeteer detail-page loop did not — a live run found only 1/5 detail
  fetches returned a page with its JobPosting JSON-LD intact; the other 4 came back with the block
  silently missing, even though manually re-opening the same URLs in a real (non-headless) browser
  session immediately after confirmed the block WAS genuinely present on all of them. This pointed
  to Cloudflare fingerprinting the headless Puppeteer session as automated after the first
  successful navigation, not a per-vacancy data gap. Presented to the user with four options
  (accept as-is, add `puppeteer-extra-plugin-stealth`, space out requests further, or switch
  enrichment to the already-spiked RSS feed); the user chose the RSS switch. The RSS feed for the
  *same* category as the HTML listing (`/categories/remote-full-stack-programming-jobs.rss`) was
  then confirmed to return the identical 120 items 1:1 by slug, is not Cloudflare-gated at all
  (plain axios, 200, no challenge), and one request replaces the entire per-vacancy Puppeteer loop
  — re-run against the live site with `maxVacanciesToCrawl: 25` afterward: 25/25 enriched, 0
  errors. `crawl()` (the listing pass) is unchanged from the original Puppeteer design.
- **No numeric `externalId`.** Unlike habr's numeric vacancy id or RemoteOK's `data-id` attribute,
  WeWorkRemotely has neither — `externalId` is the URL slug (e.g.
  `samsara-staff-software-engineer`) parsed out of the listing row's href (and, independently,
  out of the RSS feed's `<link>`/`<guid>` — the two are joined by this shared slug).
  `RawVacancy.externalId` is already typed `string`, so no type change was needed.
- **No `specialization`/`seniority`; `skillsSummary` only when the feed's `<skills>` tag is
  non-empty.** habr's labeled-clause lead-paragraph extraction has no equivalent for
  WeWorkRemotely. `specialization`/`seniority` are left unset (`undefined`) entirely; `<skills>` is
  populated on some postings and empty on others (confirmed live), so it's only included in the
  merge when non-empty. `upsertVacancy`'s only-overwrite-when-present semantics mean an unset field
  leaves any prior value alone instead of clobbering it with a fabricated `null`/`""`.
- **`maxVacanciesToCrawl` is a ceiling, not a guarantee, for this source.** The category
  page/RSS feed both show every currently-open posting in one shot (~120 on 2026-09-04) — unlike
  habr's real pagination, there is no deeper "page" of older postings to reach by raising the cap.
  Setting it above the category's actual current posting count just returns however many exist,
  same as already true for RemoteOK's fixed ~50-row listing. Documented in the strategy file.
- **`CrawlSource.type` (`STATIC`/`DYNAMIC`) removed, not renamed or reclassified.** Prompted by
  this increment's own `weworkremotely` row going stale (seeded `STATIC`, silently wrong once
  Cloudflare started gating the site — nobody was forced to notice until a live re-check). A
  design-review conversation with the user asked whether the concept was flawed, not just the
  data — confirmed by grepping the codebase: `source.type` was read in exactly one place (a UI
  tooltip in `source-detail-page.tsx`), never by dispatch or by any strategy's fetch logic
  (`getStrategy` keys on `source.name`; each strategy hardcodes its own library). So `type` wasn't
  operational config a user should tune — it was a second, disconnected copy of a fact the code
  already fully determines, with no mechanism keeping the two in sync. An intermediate idea (store
  a JSON "implementation description" blob instead of an enum column) was raised and rejected for
  the same reason: changing the *shape* of the redundant copy doesn't fix the redundancy — the fix
  is to stop storing the fact a second time at all. Landed on: a `description: string` field
  directly on each `CrawlStrategy` object (`crawler/types.ts`), read via `getStrategy(source)
  ?.description` at API response time (`sources.service.ts`'s `withStrategyDescription`) rather
  than persisted — `null` for a source with no implemented strategy. `respectRobotsTxt` was
  flagged as a likely sibling case and checked immediately after: confirmed via grep to have
  **zero** consumers anywhere in the codebase (not `type`'s one UI tooltip — literally none; not
  read by any crawl logic, not displayed in the UI, not even referenced in `seed.ts` beyond its DB
  default). Dropped in a follow-up migration
  (`20260904181020_drop_crawl_source_respect_robots_txt`) the same session, no replacement field
  needed — each source's actual `robots.txt` findings already live in the `data-sources` skill and
  per-source feature docs as real, checked facts, which is where that information belongs.

## Spike findings (2026-09-04, against the live site)

- **Cloudflare now blocks plain requests on both page types.** `curl`/`axios`, even with a
  realistic desktop-Chrome UA string, gets `403` with `cf-mitigated: challenge` on both the
  category listing page and individual job detail pages. This reverses the `data-sources` skill's
  prior "STATIC — confirmed server-rendered" finding for this source, which was accurate when
  written but has since gone stale as the site added bot protection — corrected in that skill doc
  as part of this increment.
- **A real rendered-browser session gets through both page types** (confirmed via a live Chrome
  DevTools session, not bare headless Puppeteer) — confirms a Puppeteer-based `DYNAMIC` strategy
  is viable, same precedent as RemoteOK. Caveat: bare headless Puppeteer (no stealth plugin) is a
  known target of Cloudflare's bot-management fingerprinting in a way a full real-browser session
  isn't — passing the challenge in production headless Puppeteer is not 100% guaranteed by this
  spike alone; flagged as an open risk to watch during manual verification (see below).
- **No real listing pagination.** `?page=2` on the category listing
  (`/categories/remote-full-stack-programming-jobs` — the shorter `remote-programming-jobs` slug
  301-redirects to this one) returns byte-for-byte the same ~120 rows as `?page=1`, confirmed both
  for the HTML page and the RSS feed. Same finding as RemoteOK's `?page=2` spike.
- **Listing row markup** (confirmed via live DevTools inspection): each real listing is
  `li.new-listing-container` containing `a.listing-link--unlocked` (href → `externalId` slug via
  `/remote-jobs/([^/?#]+)/`), `.new-listing__header__title` (title), `.new-listing__company-name`
  (company). ~2/122 sampled rows are promoted/ad rows with no such link — naturally skipped by the
  parser, same as a habr card missing its vacancy href.
- **Listing job-type/region tags are positionally unreliable.** `.new-listing__categories__category`
  rows carry a mix of "Featured"/"Top 100" badges and the real type/region tags, with count/order
  varying per row (2 to 4 tags observed, no fixed position) — not parsed, same "don't store a
  placeholder as if it were real data" principle as habr's dropped salary / RemoteOK's dropped
  `baseSalary`.
- **Detail page HAS a JobPosting JSON-LD block (originally used, later replaced by the RSS
  feed).** Confirmed live: exactly one JSON-LD script tag per detail page, `@type: "JobPosting"`,
  with two parsing issues (both were worked around in the original implementation): its
  `description` field contains raw, unescaped control characters (literal newlines dropped
  straight into the JSON string instead of `\n`), making `JSON.parse` throw on *every* page
  as-is — required stripping control characters before parsing, not an occasional
  malformed-row situation like RemoteOK's ~1-in-4; and once parsed, `description` is
  HTML-entity-double-encoded (`&lt;p&gt;` as six literal characters, not a real `<p>` byte),
  requiring an extra `cheerio.load(...).text()` decode pass before `htmlToText` could strip it.
  **This entire code path was removed** once the enrichment source switched to the RSS feed (see
  Decisions above) — kept here as a record of what was tried, since the JSON-LD block genuinely
  works when reachable, it's specifically the *reachability* (headless Puppeteer on repeated
  requests) that failed, not the parsing.
- **RSS feed for the same category (`/categories/remote-full-stack-programming-jobs.rss`) mirrors
  the HTML listing 1:1.** Confirmed live: identical 120 items, same slugs, same order. Its
  `<description>` has the *same* double-HTML-entity-encoding issue as the JSON-LD field did
  (same fix: one extra `cheerio.load(...).text()` decode pass before `htmlToText`), but arrives as
  well-formed XML with no control-character-breaking JSON to work around — a strictly easier parse
  target than the JSON-LD block it replaced. `<region>` (e.g. "Anywhere in the World", "USA Only")
  is populated on every item, unlike the JSON-LD's `jobLocation`, which was only present for
  geo-restricted postings — used as `location` instead. `<skills>` is a comma-separated tag, empty
  on many postings (only set on `RawVacancy` when non-empty). No RSS field maps to
  `specialization`/`seniority`. `isRemote` is still hardcoded `true` (WWR is 100%-remote by
  design, same rationale as RemoteOK), not derived from RSS data.

## Data model changes

**Schema**: `CrawlSource.maxPagesToCrawl` (`Int @default(1)`) and `CrawlSource.supportsPageLimit`
(`Boolean @default(true)`) dropped; `CrawlSource.maxVacanciesToCrawl` (`Int @default(25)`) added
(migration `20260904170434_replace_max_pages_with_max_vacancies_to_crawl`). `CrawlSource.type`
(`SourceType` enum `STATIC`/`DYNAMIC`) dropped entirely, enum type dropped too (migration
`20260904174559_drop_crawl_source_type`) — replaced by `CrawlStrategy.description` (code, not
data; see Decisions above). `CrawlSource.respectRobotsTxt` (`Boolean @default(true)`) also dropped,
no replacement (migration `20260904181020_drop_crawl_source_respect_robots_txt`) — it had zero
consumers anywhere, not even `type`'s one UI tooltip. No Elasticsearch schema change —
`RawVacancy`/`CrawlerResultDoc` are both unchanged; WeWorkRemotely's `crawl()`/`enrichDetails()`
populate only fields that already exist.

## Implementation plan

1. `apps/api/prisma/schema.prisma`: replaced `maxPagesToCrawl`/`supportsPageLimit` with
   `maxVacanciesToCrawl Int @default(25)`; hand-written migration (non-interactive environment, so
   `prisma migrate dev` couldn't be used — wrote the migration SQL directly, matching the existing
   migration-file naming/format convention, then applied via `prisma migrate deploy`).
2. `apps/api/prisma/seed.ts`: all four sources now seed `maxVacanciesToCrawl: 25`; WeWorkRemotely's
   `type` changed `STATIC` → `DYNAMIC`.
3. New shared helper `apps/api/src/crawler/vacancyCap.ts` (`applyVacancyCap`), unit-tested in
   isolation (`vacancyCap.test.ts`) — avoids duplicating slice/truncate logic across three strategy
   files, and is the one piece of new cap logic testable without axios/Redis/Puppeteer mocking
   (consistent with this repo's existing "only pure functions get unit tests" convention).
4. `habrCareerStrategy.ts`: page loop now runs until `maxVacanciesToCrawl` is reached (truncate +
   early `break`, logged) or a page returns zero vacancies (real end of results), bounded by a
   hard `MAX_PAGES_SAFETY_CEILING = 20` independent of the cap so a misconfigured high cap can't
   turn into an unbounded request loop.
5. `remoteOkStrategy.ts`: single listing fetch now truncated via `applyVacancyCap` after parsing,
   replacing the old maxPagesToCrawl-ignoring comment.
6. `apps/api/src/sources/sources.schemas.ts` / `sources.service.ts`: `maxPagesToCrawl` field/guard
   replaced with `maxVacanciesToCrawl` (range 1-200); the `supportsPageLimit` 400-guard deleted
   outright (no longer applicable to anything).
7. `apps/web`: `Source` type, `edit-source-settings` feature (API client function, validator,
   barrel exports) and `source-detail-page.tsx` all updated — the old
   `supportsPageLimit ? <input> : <"Not applicable">` branch replaced with a single always-shown
   "Vacancies to crawl" inline-editable field.
8. New `apps/api/src/crawler/strategies/weWorkRemotelyStrategy.ts`: `crawl()` fetches the listing
   once via a fresh Puppeteer browser per call (same pattern as RemoteOK). `enrichDetails()`
   **originally** launched one Puppeteer browser for the whole run and fetched each vacancy's own
   detail page (reusing `browser.newPage()` per vacancy); after the live-verification finding
   above, **rewritten** to fetch the category's RSS feed once via plain `axios` (no Puppeteer at
   all) and join its entries to the listing's vacancies by URL slug. Plus fixtures and
   parse-function unit tests (`weWorkRemotelyStrategy.test.ts`), mirroring `habrCareerStrategy
   .test.ts`'s structure — the fixture/test set was rewritten alongside the enrichDetails rewrite
   (`weWorkRemotelyRssFeed.xml` fixture replacing the earlier detail-page HTML fixtures).
9. `apps/api/src/crawler/index.ts`: registered `WeWorkRemotely: weWorkRemotelyStrategy`;
   `crawler/index.test.ts` updated (it previously asserted `getStrategy` returns `null` for
   WeWorkRemotely — now asserts it returns the real strategy, only Craigslist still returns null).
10. Docs synced (first pass): `.claude/skills/data-sources/SKILL.md` (STATIC→DYNAMIC correction,
    status, Cloudflare/pagination findings, RSS-fallback note), `CLAUDE.md`'s Data Sources table,
    `README.md`'s "Not yet implemented" list, `ARCHITECTURE.md`'s `CrawlSource` field table and
    crawl-flow description.
11. `enrichDetails()` rewrite (post-verification pivot, see Decisions): replaced
    `parseWeWorkRemotelyVacancyDetail`/`findJobPosting` (JobPosting JSON-LD via Puppeteer) with
    `parseWeWorkRemotelyRssFeed` (a slug-keyed `Map` parsed from one plain-`axios` RSS fetch);
    `enrichDetails()` no longer launches Puppeteer at all. Old detail-page HTML fixtures replaced
    with `weWorkRemotelyRssFeed.xml`; tests rewritten accordingly.
12. **`CrawlSource.type` removal**: dropped the column/enum (migration above); added
    `description: string` to the `CrawlStrategy` interface (`crawler/types.ts`) and to all three
    implemented strategy objects; `sources.service.ts` gained `withStrategyDescription`/
    `getSourceByIdWithStrategyInfo`, computing `strategyDescription` via `getStrategy(source)
    ?.description` for `listSources`/`getSource`/`updateSourceSettings`'s API responses (internal
    callers of the plain `getSourceById` are unaffected — they only need `baseUrl`/
    `defaultDelayMs`/`maxVacanciesToCrawl` to actually run a crawl, not the display string).
    `apps/web`: `Source.type`/`SourceType` replaced with `Source.strategyDescription: string |
    null`; `source-detail-page.tsx`'s `typeTooltip` helper deleted, "Type: DYNAMIC" line replaced
    with "Implementation: <strategyDescription ?? 'Not implemented yet'>".
13. Docs synced (second pass, for the `type` removal): `ARCHITECTURE.md`'s `CrawlSource` table row
    and `CrawlStrategy` key-interfaces entry, `.claude/skills/data-sources/SKILL.md`'s "Type"
    table column renamed to "Fetch mechanism" and its `type`/dispatch prose rewritten, `CLAUDE.md`'s
    Data Sources table and two Tech-Stack/Axioms bullet points that referenced `CrawlSource.type`.

## Verification (manual, per CLAUDE.md's Testing Philosophy)

- [x] `npm run test` inside `apps/api`: 34/34 passing — `weWorkRemotelyStrategy.test.ts` (listing
      parse + `parseWeWorkRemotelyRssFeed`, including the double-decoded-entity case and the
      empty-`<skills>`-tag omission case), `vacancyCap.test.ts`, and an updated
      `crawler/index.test.ts` (WeWorkRemotely now asserts a real strategy, not `null`).
- [x] `npx tsc --noEmit` clean in both `apps/api` and `apps/web`, after every stage of this
      increment (vacancy cap, WWR strategy, RSS rewrite, `type` removal).
- [x] Migrations applied and seed re-run against the live local Postgres (twice: once for the
      vacancy-cap schema change, once for the `type` column drop).
- [x] Opened each source's detail page in the browser: "Pages to crawl" gone everywhere, replaced
      by an always-editable "Vacancies to crawl" field (25 by default); "Type: DYNAMIC/STATIC"
      gone, replaced by "Implementation: <strategyDescription>" (or "Not implemented yet" for
      Craigslist) — confirmed via screenshot for WeWorkRemotely and Craigslist.
- [x] Re-ran a real `habr_career` crawl with `maxVacanciesToCrawl: 3`: `CrawlLog` showed "fetched
      page 1 ... 25 vacancies" → "reached maxVacanciesToCrawl (3) - stopping early" → `COMPLETED`
      with exactly 3 vacancies, all 3 detail-enriched — confirms the page loop stopped, not just
      that the stored count was capped.
- [x] Triggered a real WeWorkRemotely crawl (`maxVacanciesToCrawl: 5`) with the **original**
      Puppeteer-detail-page design: listing succeeded (120 rows, no Cloudflare block), but
      `enrichDetails` only succeeded on 1/5 — the other 4 failed with "no JobPosting JSON-LD block
      found" despite the block genuinely being present when the same URL was re-opened in a real
      browser immediately after. Diagnosed as Cloudflare fingerprinting the headless Puppeteer
      session as automated after its first successful navigation, not a per-vacancy data gap.
      Reported to the user with four options; user chose switching `enrichDetails` to the RSS
      feed.
- [x] Rewrote `enrichDetails()` to use the category's RSS feed (plain axios, no Puppeteer) and
      re-ran the same crawl with `maxVacanciesToCrawl: 25`: `COMPLETED`, **25/25** enriched, 0
      errors — confirmed via `CrawlLog` and by spot-checking stored vacancies (real `description`,
      `location`, `postedAt`, `skillsSummary` where the feed's `<skills>` tag was non-empty).
- [x] Test crawl data cleared from both sources (`POST /sources/:id/clear-data`) after
      verification; `maxVacanciesToCrawl` reset to the seeded default (25) on both.

## Out of scope

- Craigslist strategy — remains deferred.
- Automated integration tests of `crawl()`/`enrichDetails()` orchestration (axios/Puppeteer/Redis
  mocking) — consistent with the existing "pure parse functions only" test convention.
- `puppeteer-extra-plugin-stealth` or other headless-detection countermeasures — not needed once
  `enrichDetails` moved off Puppeteer entirely; would only become relevant again if `crawl()`'s
  own Puppeteer listing fetch started showing the same fingerprinting symptom (not observed —
  120/120 listing fetches succeeded across every run in this increment).
- Salary field for WeWorkRemotely (the JobPosting JSON-LD's `baseSalary`, back when that was still
  the enrichment source, looked like real per-employer data on the one sampled posting, unlike
  RemoteOK's boilerplate — but not verified across enough samples to trust, moot now that
  enrichment comes from the RSS feed instead, and out of scope regardless per the project-wide
  "salary deferred" decision).
- Multiple WeWorkRemotely categories aggregated into one source, or a real per-category
  `CrawlSource` row each (raised in discussion as a way past the ~120-vacancy ceiling — see the
  strategy file's comment on `maxVacanciesToCrawl` as a ceiling, not a guarantee) — not
  implemented; would need either a `baseUrl`-derived category path (making the strategy
  source-agnostic) or in-strategy multi-category aggregation with cross-category dedup.
