import type { CrawlRun, CrawlSource } from "@prisma/client";
import { getStrategy } from "./index.js";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { upsertVacancy } from "../search/upsertVacancy.js";

interface RunState {
  cancelled: boolean;
}

// Keyed by sourceId, not runId — crawling is per-source and at most one run is active per
// source at a time (see reserveCrawlSlot).
const activeRuns = new Map<number, RunState>();

export function isSourceCrawling(sourceId: number): boolean {
  return activeRuns.has(sourceId);
}

/**
 * Reserves the concurrency slot for a source synchronously (no `await` between the caller's
 * `isSourceCrawling` check and this call), so two near-simultaneous crawl requests for the same
 * source can't both pass the check — Node's single-threaded event loop makes the pair atomic.
 * Callers must `releaseCrawlSlot` if they fail before reaching `executeCrawlRun`.
 */
export function reserveCrawlSlot(sourceId: number): void {
  activeRuns.set(sourceId, { cancelled: false });
}

export function releaseCrawlSlot(sourceId: number): void {
  activeRuns.delete(sourceId);
}

async function logInfo(runId: number, message: string): Promise<void> {
  await prisma.crawlLog.create({ data: { runId, message } });
}

async function logWarn(runId: number, message: string): Promise<void> {
  await prisma.crawlLog.create({ data: { runId, level: "WARN", message } });
}

async function logError(runId: number, message: string): Promise<void> {
  await prisma.crawlLog.create({ data: { runId, level: "ERROR", message } });
}

/**
 * Executes a crawl run to completion. The caller must have already created the `CrawlRun` row
 * and reserved the source's concurrency slot via `reserveCrawlSlot` (see
 * `sources.service.ts`'s `startSourceCrawl`) before calling this, fire-and-forget.
 */
export async function executeCrawlRun(run: CrawlRun, source: CrawlSource): Promise<void> {
  const runState = activeRuns.get(source.id);
  if (!runState) {
    // Defensive: every caller must reserve the slot first. Logging (not throwing) here since
    // this runs unawaited — an uncaught throw would just become an "unhandled rejection" log.
    logger.error(`executeCrawlRun called for source ${source.id} without a reserved crawl slot`);
    return;
  }

  await logInfo(run.id, `Starting crawl of ${source.name}`);

  let vacanciesFound = 0;
  try {
    const strategy = getStrategy(source);
    if (!strategy) {
      await logWarn(run.id, `crawling not yet implemented for ${source.name}`);
    } else {
      const { vacancies, pageLogs } = await strategy.crawl(source);
      for (const line of pageLogs) {
        await logInfo(run.id, line);
      }
      for (const vacancy of vacancies) {
        await upsertVacancy(vacancy);
      }
      vacanciesFound = vacancies.length;
      await logInfo(run.id, `Found ${vacancies.length} vacancies for ${source.name}`);

      if (strategy.enrichDetails && vacancies.length > 0) {
        await logInfo(
          run.id,
          `Enriching vacancy details for ${source.name} (${vacancies.length} vacancies)`,
        );
        const { enrichedCount } = await strategy.enrichDetails(
          source,
          vacancies,
          () => runState.cancelled,
          (message, level) => {
            if (level === "ERROR") return logError(run.id, message);
            if (level === "WARN") return logWarn(run.id, message);
            return logInfo(run.id, message);
          },
        );
        await logInfo(
          run.id,
          `Enriched ${enrichedCount}/${vacancies.length} vacancies for ${source.name}`,
        );
      }
    }
  } catch (error) {
    logger.error(`Failed to crawl source ${source.name} (run ${run.id}): ${String(error)}`);
    await logError(run.id, `Failed to crawl ${source.name}: ${String(error)}`);
  }

  activeRuns.delete(source.id);

  // If stopped by the user mid-run, stopCrawlRun already flipped RUNNING -> STOPPED and wrote its
  // own CrawlLog line — don't also try to complete the run.
  if (runState.cancelled) return;

  try {
    // Status-conditioned update: if the run was already stopped right as the crawl above
    // finished, this affects 0 rows and we skip appending a "Crawl completed" log that would
    // contradict the STOPPED status.
    const { count } = await prisma.crawlRun.updateMany({
      where: { id: run.id, status: "RUNNING" },
      data: { status: "COMPLETED", finishedAt: new Date(), vacanciesFound },
    });
    if (count > 0) {
      await logInfo(run.id, "Crawl completed");
    }
  } catch (error) {
    logger.error(`Failed to finish crawl run ${run.id}: ${String(error)}`);
  }
}

export function stopCrawlRun(sourceId: number): void {
  const runState = activeRuns.get(sourceId);
  if (!runState) return;
  runState.cancelled = true;
  activeRuns.delete(sourceId);
}
