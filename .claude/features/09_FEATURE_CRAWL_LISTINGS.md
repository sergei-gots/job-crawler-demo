# FEATURE: CrawlListing — 1:N Sub-Targets per CrawlSource (Increment 9)

## Overview

`weWorkRemotelyStrategy.ts` (Increment 6) hardcoded a single category listing
(`/categories/remote-full-stack-programming-jobs`) as a module constant. WeWorkRemotely — and,
observed while designing this increment, RemoteOK too — actually exposes several such
category-scoped listings, each with its own ~fixed-size, non-paginated result set (the same "no
deeper page to reach" ceiling already documented for the one category crawled since Increment 6).

This increment introduces `CrawlListing`: a real, named, independently-crawlable sub-target that
belongs to a `CrawlSource`. Crawling moves from "always the whole source" to "the source itself,
or one of its listings" — additive, not a replacement, so the two sources that don't need this
concept (`Habr Career`, `RemoteOK`) keep working exactly as before.

## Decisions locked with the user

- **`CrawlListing` is additive, not a forced 1-per-source minimum.** Considered forcing every
  source to have at least one listing row (uniform model, single code path) vs. making listings
  purely optional (nullable `CrawlRun.listingId`, only sources that need it get `CrawlListing`
  rows). Chose optional: forcing a synthetic "default" listing onto `Habr Career`/`RemoteOK` —
  which don't need this concept — would touch two already-working, tested strategies for zero
  functional gain, purely for code-path uniformity.
- **Crawling happens at the listing level for sources that have listings**, not the source level.
  `weWorkRemotelyStrategy.crawl`/`enrichDetails` now require a non-null `CrawlListing` (throw a
  defensive error if ever called with `null`) and derive their target URL from
  `new URL(listing.subPath, source.baseUrl)` instead of the deleted `LISTING_PATH`/`RSS_PATH`
  constants. `habrCareerStrategy`/`remoteOkStrategy` accept the same new parameter and simply
  ignore it (always called with `null`, since neither is seeded with any `CrawlListing` rows).
- **Concurrency slot key becomes `listingId ?? sourceId`.** `crawlRunner.ts`'s `activeRuns` map
  was keyed by `sourceId` alone (`isSourceCrawling`/`reserveCrawlSlot`). Generalized to
  `isSlotCrawling`/`reserveCrawlSlot(sourceId, listingId?)` via a `slotKeyFor` helper, so
  WeWorkRemotely's different listings can crawl concurrently (independent locks) while sources
  without listings keep exactly today's single-lock-per-source behavior.
- **The strategy diagram (`strategySteps`/`strategyDescription`) stays on `CrawlSource`, not
  per-listing.** The mechanism/problem/fix narrative in `weWorkRemotelyStrategy.steps` is
  identical across a site's listings (same Cloudflare/headless-fingerprinting story, same RSS
  fallback) — duplicating it per-listing would be wrong, not just redundant.
- **Listings are seed-only, not user-CRUD-able**, matching the existing precedent that
  `CrawlSource` rows themselves are seeded, not user-editable (`ARCHITECTURE.md`). Only
  `isActive` is user-editable — a checkbox, immediate-apply (no Save button), since a checkbox
  toggle is a single deliberate action, unlike the free-text numeric fields on the source detail
  page that use an explicit Save button.
- **`crawl-all` routes through listings for a source that has any.** `startAllSourcesCrawl` used
  to always call `startSourceCrawl` per active source. A source with listings now starts one crawl
  per active listing instead — `weWorkRemotelyStrategy` throws if handed a `null` listing, so
  calling the old source-level path for it would fail every time.
- **Start with one seeded listing** (`Full-Stack`, the category already live-verified in
  Increment 6) rather than guessing several category slugs up front — matches this project's
  standing rule of never seeding an unverified selector/URL. A second listing (`Backend` →
  `/categories/remote-back-end-programming-jobs`) was added the same way shortly after, once its
  HTML listing and matching `.rss` feed were live-verified.

## What was built

### Schema (`apps/api/prisma/schema.prisma`, migration `20260904220249_add_crawl_listing`)

```prisma
model CrawlListing {
  id        Int         @id @default(autoincrement())
  sourceId  Int
  source    CrawlSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  label     String
  subPath   String
  isActive  Boolean     @default(true)
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  runs CrawlRun[]

  @@unique([sourceId, subPath])
  @@map("crawl_listings")
}
```

`CrawlSource` gains `listings CrawlListing[]`. `CrawlRun` gains a nullable `listingId` +
relation.

### Seed (`apps/api/prisma/seed.ts`)

Two `CrawlListing` rows for `WeWorkRemotely`: `Full-Stack` →
`/categories/remote-full-stack-programming-jobs` and `Backend` →
`/categories/remote-back-end-programming-jobs`. No listings for the other three sources.

### `apps/api/src/crawler/types.ts` + strategy files

`CrawlStrategy.crawl`/`enrichDetails` gain a `listing: CrawlListing | null` parameter.
`weWorkRemotelyStrategy.ts` deletes `LISTING_PATH`/`RSS_PATH`, adds a `listingUrl(source,
listing)` helper (throws if `listing` is `null`) used for both the listing fetch and the
`${listingUrl}.rss` enrichment feed. `habrCareerStrategy.ts`/`remoteOkStrategy.ts` accept and
ignore the parameter (named `_listing`).

### `apps/api/src/crawler/crawlRunner.ts`

`slotKeyFor(sourceId, listingId)` → `listingId ?? sourceId`. `isSourceCrawling` renamed
`isSlotCrawling`; `reserveCrawlSlot`/`releaseCrawlSlot`/`stopCrawlRun`/`waitUntilNotCrawling` all
take an optional `listingId`. `executeCrawlRun` takes an optional `listing: CrawlListing | null`,
threaded into `strategy.crawl`/`enrichDetails`.

### `apps/api/src/sources/sources.service.ts` + controller + routes

New functions: `getListingById`, `startListingCrawl`, `stopListingCrawl`, `getListingRun`,
`updateListingActive`. `listSources`/`getSourceByIdWithStrategyInfo` now attach a lightweight
`listings: { id, label, subPath, isActive }[]` per source. `startAllSourcesCrawl` routes through
active listings for a source that has any (see decision above). `stopAndWaitForSource` (used by
`clearSourceData`) also stops/waits for any of the source's listing-scoped crawls, since
`clearSourceData` deletes every `CrawlRun` row for that `sourceId`, listing-scoped ones included.

New routes:
```
GET   /sources/:id/listings                          (folded into GET /sources and GET /sources/:id)
POST  /sources/:id/listings/:listingId/crawl
POST  /sources/:id/listings/:listingId/crawl/stop
GET   /sources/:id/listings/:listingId/run
PATCH /sources/:id/listings/:listingId                (isActive only)
```

### Web

- `entities/source`: new `Listing` type on `Source.listings`; new `getListingRun` fetcher.
- `features/edit-source-settings`: new `updateListingActive` action (immediate-apply).
- `features/run-crawl`: `useCrawlActions` widened from a bare `pendingId: number` to a
  discriminated `CrawlSlotKey` (`{ kind: "source"; sourceId } | { kind: "listing"; sourceId;
  listingId }`), with `sourceSlot`/`listingSlot` constructors and an `isPending(key)` helper —
  needed because a source id and a listing id share the same numeric space.
- `widgets/sources/ui/sources-page.tsx`: a source with listings shows `(N listing(s))` next to
  its name and a `+`/`−` toggle (placed after the row number, before the name) that reveals an
  indented listing row per `CrawlListing` (isActive checkbox, status, link to the listing's own
  detail page — no per-listing Start/Stop here, only on the listing's own detail page). The
  base-url row itself keeps a status badge and a Start/Stop button, but aggregated: `RUNNING` if
  any listing is running, else the most-recently-run listing's status; the button starts/stops
  every active listing at once (`startListingCrawl`/`stopListingCrawl` per listing, in parallel).
  The page-level "Clear cache"/"Clear search data" buttons moved to the bottom-left of the
  sources card and "Crawl all" to the bottom-right (previously all three sat in the card header).
- `widgets/source-detail/ui/source-detail-page.tsx`: when `source.listings.length > 0`, the
  source-level Start/Stop is replaced with links to each listing's detail page (starting the
  source itself would throw, since its strategy requires a listing).
- `widgets/listing-detail/` (new) + `app/sources/[id]/listings/[listingId]/page.tsx` (new route):
  mirrors `source-detail-page.tsx`'s Execution logs/Vacancies panel structure, scoped to one
  listing — does **not** get its own "Applied crawling strategy" panel (that stays on the parent
  source page only, per the decision above); links back to the parent source.

## Data model changes

`CrawlListing` (new table, see schema above). `CrawlRun.listingId` (new nullable column + FK,
cascade-deletes with its `CrawlListing`).

## Verification

- [x] `apps/api`: `npx tsc --noEmit` clean; `npm run test` 34/34 (existing strategy tests call
      the pure parse functions directly, unaffected by the new `listing` parameter on
      `crawl()`/`enrichDetails()` itself).
- [x] `apps/web`: `npx tsc --noEmit` clean.
- [x] Manual: `GET /sources` includes a `listings` array for `WeWorkRemotely`, empty for the other
      three.
- [x] Manual: `POST /sources/:id/listings/:listingId/crawl` reaches `COMPLETED` with real
      vacancies and `CrawlRun.listingId` set correctly.
- [x] Manual: `/sources` UI — `WeWorkRemotely` row shows a `+`; expanding reveals each listing
      with its own checkbox/status and a link into its own detail page; the base-url row itself
      shows an aggregated status (`RUNNING` if any listing is, else the most recently run
      listing's status) and a Start/Stop-all-listings button; `Habr Career`/`RemoteOK`/
      `Craigslist` show no `+` and behave exactly as before.
- [x] Manual: listing detail page's Execution logs/Vacancies panels work independently of the
      parent source's, and it shows no "Applied crawling strategy" panel.
- [x] Manual: toggling a listing's `isActive` checkbox persists across reload, and `crawl-all`
      skips it while inactive.

## Out of scope

- Listing CRUD (add/remove/edit `label`/`subPath` via the UI) — listings stay seed-only, same as
  `CrawlSource` rows themselves.
- Additional WeWorkRemotely category listings beyond `Full-Stack`/`Backend` — add the same way these were
  seeded: a live check of the category slug first, then a seed entry.
- RemoteOK listings, despite that site also having category-scoped pages — not requested this
  increment; `remoteOkStrategy` already accepts the `listing` parameter so adding them later is a
  seed + URL-derivation change, not an architecture change.
