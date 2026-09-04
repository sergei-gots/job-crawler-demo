import type { CrawlListing, CrawlLog, CrawlRun, CrawlSource } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/errors.js";
import { queryVacanciesForListing, queryVacanciesForSource } from "../search/queryVacancies.js";
import { deleteVacanciesForSource } from "../search/deleteVacancies.js";
import type { CrawlerResultDoc } from "../search/crawlerResultsIndex.js";
import type { UpdateSourceSettingsInput } from "./sources.schemas.js";
import { getStrategy } from "../crawler/index.js";
import type { StrategyStep } from "../crawler/types.js";
import {
  executeCrawlRun,
  isSlotCrawling,
  releaseCrawlSlot,
  reserveCrawlSlot,
  stopCrawlRun,
  waitUntilNotCrawling,
} from "../crawler/crawlRunner.js";

// Generic fallback for a source with no implemented CrawlStrategy yet (currently only
// Craigslist) - deliberately NOT source-specific research content (e.g. Craigslist's actual
// anti-scraping enforcement history lives in the data-sources skill only, not duplicated here).
// The UI diagram's job is to show mechanism actually executed, and for these sources that
// mechanism is simply "nothing runs."
const NOT_IMPLEMENTED_STEPS: StrategyStep[] = [
  {
    type: "process",
    title: "Crawl triggered",
    detail: { explanation: 'getStrategy(source.name) is looked up in the strategy registry.' },
  },
  {
    type: "terminal",
    title: "No CrawlStrategy implemented yet",
    detail: { explanation: "WARN logged, run completes with 0 vacancies rather than failing." },
  },
];

/**
 * How this source is actually crawled, read straight from its `CrawlStrategy` (see
 * `CrawlStrategy.description`/`steps` in `crawler/types.ts`) rather than a separate DB column —
 * there's nothing to keep in sync because there's only one copy of this fact, in the strategy
 * file itself. Falls back to `NOT_IMPLEMENTED_STEPS`/`null` for a source with no implemented
 * strategy yet (e.g. Craigslist).
 */
/** Lightweight listing shape for the Sources page's expand-to-reveal-listings UI. */
export interface ListingInfo {
  id: number;
  label: string;
  subPath: string;
  isActive: boolean;
}

export interface SourceWithStrategyInfo extends CrawlSource {
  strategyDescription: string | null;
  strategySteps: StrategyStep[];
  listings: ListingInfo[];
}

async function withStrategyInfo(source: CrawlSource): Promise<SourceWithStrategyInfo> {
  const strategy = getStrategy(source);
  const listings = await prisma.crawlListing.findMany({
    where: { sourceId: source.id },
    orderBy: { id: "asc" },
    select: { id: true, label: true, subPath: true, isActive: true },
  });
  return {
    ...source,
    strategyDescription: strategy?.description ?? null,
    strategySteps: strategy?.steps ?? NOT_IMPLEMENTED_STEPS,
    listings,
  };
}

export async function listSources(): Promise<SourceWithStrategyInfo[]> {
  const sources = await prisma.crawlSource.findMany({ orderBy: { id: "asc" } });
  return Promise.all(sources.map(withStrategyInfo));
}

export async function getSourceById(id: number): Promise<CrawlSource> {
  const source = await prisma.crawlSource.findUnique({ where: { id } });
  if (!source) {
    throw new ApiError(404, "Source not found");
  }
  return source;
}

/** Controller-facing variant of `getSourceById` that also attaches strategy info. */
export async function getSourceByIdWithStrategyInfo(id: number): Promise<SourceWithStrategyInfo> {
  return withStrategyInfo(await getSourceById(id));
}

/** Throws 404 if the listing doesn't exist or doesn't belong to this source. */
export async function getListingById(sourceId: number, listingId: number): Promise<CrawlListing> {
  const listing = await prisma.crawlListing.findUnique({ where: { id: listingId } });
  if (!listing || listing.sourceId !== sourceId) {
    throw new ApiError(404, "Listing not found");
  }
  return listing;
}

export async function updateSourceSettings(
  id: number,
  input: UpdateSourceSettingsInput,
): Promise<SourceWithStrategyInfo> {
  await getSourceById(id);
  const updated = await prisma.crawlSource.update({
    where: { id },
    data: {
      ...(input.maxVacanciesToCrawl !== undefined && { maxVacanciesToCrawl: input.maxVacanciesToCrawl }),
      ...(input.defaultDelayMs !== undefined && { defaultDelayMs: input.defaultDelayMs }),
    },
  });
  return await withStrategyInfo(updated);
}

export async function getSourceVacancies(id: number): Promise<CrawlerResultDoc[]> {
  await getSourceById(id);
  return queryVacanciesForSource(id);
}

export async function getListingVacancies(
  sourceId: number,
  listingId: number,
): Promise<CrawlerResultDoc[]> {
  await getListingById(sourceId, listingId);
  return queryVacanciesForListing(sourceId, listingId);
}

/**
 * Crawling is global, not owned per user (see CLAUDE.md → Security Considerations) — any
 * logged-in user can start/stop a crawl for any source. The only guard is "at most one active
 * run per source at a time", enforced synchronously via reserveCrawlSlot before any DB `await`.
 */
export async function startSourceCrawl(id: number): Promise<CrawlRun> {
  if (isSlotCrawling(id)) {
    throw new ApiError(400, "A crawl is already running for this source");
  }
  reserveCrawlSlot(id);

  try {
    const source = await getSourceById(id);
    const run = await prisma.crawlRun.create({
      data: { sourceId: id, status: "RUNNING", startedAt: new Date() },
    });

    // Fire-and-forget: a real crawl takes real time (rate-limited network requests). The
    // frontend polls GET /sources/:id/run while status is RUNNING, so the run continues in the
    // background and the HTTP response here returns immediately with the RUNNING status.
    executeCrawlRun(run, source).catch((error: unknown) => {
      logger.error(`Unhandled error in crawl run ${run.id}: ${String(error)}`);
    });

    return run;
  } catch (error) {
    releaseCrawlSlot(id);
    throw error;
  }
}

/**
 * Same as `startSourceCrawl` but for one `CrawlListing` sub-target (see .claude/features/
 * 09_FEATURE_CRAWL_LISTINGS.md) - the concurrency slot is keyed by listingId, so different
 * listings of the same source can crawl concurrently.
 */
export async function startListingCrawl(sourceId: number, listingId: number): Promise<CrawlRun> {
  if (isSlotCrawling(sourceId, listingId)) {
    throw new ApiError(400, "A crawl is already running for this listing");
  }
  reserveCrawlSlot(sourceId, listingId);

  try {
    const source = await getSourceById(sourceId);
    const listing = await getListingById(sourceId, listingId);
    const run = await prisma.crawlRun.create({
      data: { sourceId, listingId, status: "RUNNING", startedAt: new Date() },
    });

    executeCrawlRun(run, source, listing).catch((error: unknown) => {
      logger.error(`Unhandled error in crawl run ${run.id}: ${String(error)}`);
    });

    return run;
  } catch (error) {
    releaseCrawlSlot(sourceId, listingId);
    throw error;
  }
}

export async function stopSourceCrawl(id: number): Promise<CrawlRun> {
  const run = await prisma.crawlRun.findFirst({
    where: { sourceId: id, listingId: null, status: "RUNNING" },
    orderBy: { id: "desc" },
  });
  if (!run) {
    throw new ApiError(400, "No crawl is running for this source");
  }

  stopCrawlRun(id);

  // Status-conditioned update, mirroring startSourceCrawl's own guard: if the run's own
  // completion logic already flipped it to COMPLETED between the read above and here, this
  // affects 0 rows and we report "not running" instead of overwriting a completed run.
  const { count } = await prisma.crawlRun.updateMany({
    where: { id: run.id, status: "RUNNING" },
    data: { status: "STOPPED", finishedAt: new Date() },
  });
  if (count === 0) {
    throw new ApiError(400, "No crawl is running for this source");
  }

  await prisma.crawlLog.create({ data: { runId: run.id, message: "Stopped by user" } });

  return prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } });
}

export async function stopListingCrawl(sourceId: number, listingId: number): Promise<CrawlRun> {
  await getListingById(sourceId, listingId);
  const run = await prisma.crawlRun.findFirst({
    where: { sourceId, listingId, status: "RUNNING" },
    orderBy: { id: "desc" },
  });
  if (!run) {
    throw new ApiError(400, "No crawl is running for this listing");
  }

  stopCrawlRun(sourceId, listingId);

  const { count } = await prisma.crawlRun.updateMany({
    where: { id: run.id, status: "RUNNING" },
    data: { status: "STOPPED", finishedAt: new Date() },
  });
  if (count === 0) {
    throw new ApiError(400, "No crawl is running for this listing");
  }

  await prisma.crawlLog.create({ data: { runId: run.id, message: "Stopped by user" } });

  return prisma.crawlRun.findUniqueOrThrow({ where: { id: run.id } });
}

export async function getListingRun(
  sourceId: number,
  listingId: number,
): Promise<(CrawlRun & { logs: CrawlLog[] }) | null> {
  await getListingById(sourceId, listingId);
  return prisma.crawlRun.findFirst({
    where: { sourceId, listingId },
    orderBy: { id: "desc" },
    include: { logs: { orderBy: { createdAt: "asc" } } },
  });
}

export async function updateListingActive(
  sourceId: number,
  listingId: number,
  isActive: boolean,
): Promise<ListingInfo> {
  await getListingById(sourceId, listingId);
  const updated = await prisma.crawlListing.update({
    where: { id: listingId },
    data: { isActive },
  });
  return {
    id: updated.id,
    label: updated.label,
    subPath: updated.subPath,
    isActive: updated.isActive,
  };
}

/**
 * Stops this source's crawl (if any) and waits for the background task to actually finish before
 * returning — the safe precondition before mutating a source's data (deleting it, most notably).
 * Throws rather than silently proceeding if the wait times out: a caller that pressed ahead
 * anyway would just narrow the exact race this exists to close instead of actually closing it
 * (the still-running task could write a `CrawlLog` against, or re-insert vacancies for, data the
 * caller is about to delete). Exported so both `clearSourceData` below and `admin.service.ts`'s
 * `clearSearchData` (which needs the same sequence for every source, not just one) share one
 * implementation instead of hand-rolling it twice.
 *
 * The wait budget scales with this source's own `defaultDelayMs`: `enrichDetails`'s retry loop
 * only checks cancellation *before* each rate-limited fetch, not during the `waitForSlot` sleep
 * itself, so up to a full `defaultDelayMs` can pass with no cancellation check at all. A fixed
 * short timeout here (e.g. 5s) would then time out on every source whose delay exceeds it —
 * reproduced live for `habr_career` (`defaultDelayMs: 12000`), where "Clear data" clicked during
 * an active crawl failed almost every time with "Timed out waiting for the crawl to stop".
 *
 * Also stops/waits for any of this source's `CrawlListing` sub-targets that are currently
 * crawling (independent slots — see crawlRunner.ts's `slotKeyFor`) — `clearSourceData` deletes
 * every `CrawlRun` row for this sourceId, listing-scoped ones included, so all of them must be
 * safely stopped first, not just the source-level one.
 */
export async function stopAndWaitForSource(id: number): Promise<void> {
  const source = await prisma.crawlSource.findUnique({
    where: { id },
    select: { defaultDelayMs: true },
  });
  const timeoutMs = (source?.defaultDelayMs ?? 2000) + 8000;

  if (isSlotCrawling(id)) {
    await stopSourceCrawl(id);
    const stopped = await waitUntilNotCrawling(id, null, timeoutMs);
    if (!stopped) {
      throw new ApiError(409, "Timed out waiting for the crawl to stop — try again");
    }
  }

  const listings = await prisma.crawlListing.findMany({ where: { sourceId: id }, select: { id: true } });
  for (const listing of listings) {
    if (!isSlotCrawling(id, listing.id)) continue;
    await stopListingCrawl(id, listing.id);
    const stopped = await waitUntilNotCrawling(id, listing.id, timeoutMs);
    if (!stopped) {
      throw new ApiError(409, "Timed out waiting for the crawl to stop — try again");
    }
  }
}

/**
 * Deletes this source's crawled vacancies from Elasticsearch, and its `CrawlRun`/`CrawlLog`
 * history from Postgres (cascade-deleted via the CrawlLog->CrawlRun relation) — so the source
 * goes back to a genuinely fresh "never crawled" (PENDING) state rather than leaving a stale
 * COMPLETED/STOPPED status and vacancy count that no longer match the now-empty ES data.
 */
export async function clearSourceData(id: number): Promise<void> {
  await getSourceById(id);
  await stopAndWaitForSource(id);
  await deleteVacanciesForSource(id);
  await prisma.crawlRun.deleteMany({ where: { sourceId: id } });
}

/**
 * Starts a crawl for every crawlable, active source, skipping any already-running one. A source
 * with `CrawlListing` rows (see .claude/features/09_FEATURE_CRAWL_LISTINGS.md) crawls at the
 * listing level instead of the source level - starting one crawl per active listing, same
 * `isActive` filtering semantics as the source loop itself - since its strategy requires a
 * specific listing (e.g. weWorkRemotelyStrategy throws if called with `listing: null`).
 */
export async function startAllSourcesCrawl(): Promise<CrawlRun[]> {
  const sources = await prisma.crawlSource.findMany({
    where: { isActive: true },
    include: { listings: true },
  });
  const runs: CrawlRun[] = [];

  for (const source of sources) {
    if (source.listings.length > 0) {
      for (const listing of source.listings) {
        if (!listing.isActive || isSlotCrawling(source.id, listing.id)) continue;
        runs.push(await startListingCrawl(source.id, listing.id));
      }
      continue;
    }
    if (isSlotCrawling(source.id)) continue;
    runs.push(await startSourceCrawl(source.id));
  }

  return runs;
}

export async function getSourceRun(id: number): Promise<(CrawlRun & { logs: CrawlLog[] }) | null> {
  await getSourceById(id);
  return prisma.crawlRun.findFirst({
    where: { sourceId: id },
    orderBy: { id: "desc" },
    include: { logs: { orderBy: { createdAt: "asc" } } },
  });
}
