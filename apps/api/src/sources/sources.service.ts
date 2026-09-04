import type { CrawlLog, CrawlRun, CrawlSource } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/errors.js";
import { queryVacanciesForSource } from "../search/queryVacancies.js";
import { deleteVacanciesForSource } from "../search/deleteVacancies.js";
import type { CrawlerResultDoc } from "../search/crawlerResultsIndex.js";
import type { UpdateSourceSettingsInput } from "./sources.schemas.js";
import {
  executeCrawlRun,
  isSourceCrawling,
  releaseCrawlSlot,
  reserveCrawlSlot,
  stopCrawlRun,
  waitUntilNotCrawling,
} from "../crawler/crawlRunner.js";

export function listSources(): Promise<CrawlSource[]> {
  return prisma.crawlSource.findMany({ orderBy: { id: "asc" } });
}

export async function getSourceById(id: number): Promise<CrawlSource> {
  const source = await prisma.crawlSource.findUnique({ where: { id } });
  if (!source) {
    throw new ApiError(404, "Source not found");
  }
  return source;
}

export async function updateSourceSettings(
  id: number,
  input: UpdateSourceSettingsInput,
): Promise<CrawlSource> {
  const source = await getSourceById(id);
  if (input.maxPagesToCrawl !== undefined && !source.supportsPageLimit) {
    throw new ApiError(
      400,
      `${source.name}'s listing has no real pagination, so maxPagesToCrawl has no effect for it`,
    );
  }
  return prisma.crawlSource.update({
    where: { id },
    data: {
      ...(input.maxPagesToCrawl !== undefined && { maxPagesToCrawl: input.maxPagesToCrawl }),
      ...(input.defaultDelayMs !== undefined && { defaultDelayMs: input.defaultDelayMs }),
    },
  });
}

export async function getSourceVacancies(id: number): Promise<CrawlerResultDoc[]> {
  await getSourceById(id);
  return queryVacanciesForSource(id);
}

/**
 * Crawling is global, not owned per user (see CLAUDE.md → Security Considerations) — any
 * logged-in user can start/stop a crawl for any source. The only guard is "at most one active
 * run per source at a time", enforced synchronously via reserveCrawlSlot before any DB `await`.
 */
export async function startSourceCrawl(id: number): Promise<CrawlRun> {
  if (isSourceCrawling(id)) {
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

export async function stopSourceCrawl(id: number): Promise<CrawlRun> {
  const run = await prisma.crawlRun.findFirst({
    where: { sourceId: id, status: "RUNNING" },
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
 */
export async function stopAndWaitForSource(id: number): Promise<void> {
  if (!isSourceCrawling(id)) return;
  await stopSourceCrawl(id);
  const source = await prisma.crawlSource.findUnique({
    where: { id },
    select: { defaultDelayMs: true },
  });
  const timeoutMs = (source?.defaultDelayMs ?? 2000) + 8000;
  const stopped = await waitUntilNotCrawling(id, timeoutMs);
  if (!stopped) {
    throw new ApiError(409, "Timed out waiting for the crawl to stop — try again");
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

/** Starts a crawl for every crawlable, active source, skipping any already-running one. */
export async function startAllSourcesCrawl(): Promise<CrawlRun[]> {
  const sources = await prisma.crawlSource.findMany({ where: { isActive: true } });
  const runs: CrawlRun[] = [];

  for (const source of sources) {
    if (isSourceCrawling(source.id)) continue;
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
