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

/**
 * Polls until a source's background crawl task has actually finished (not just been asked to
 * stop) — `executeCrawlRun` only checks `cancelled` between iterations, so there's a real gap
 * between `stopCrawlRun` and the task winding down. Callers that need to safely act on a source's
 * data right after stopping it (e.g. deleting it) should await this first. Bounded at 5s so a
 * caller can't hang forever if something goes wrong. Returns whether the source actually stopped
 * crawling in time — callers should treat a `false` as "not safe to proceed" (e.g. abort a
 * destructive delete) rather than silently continuing, which would just narrow the exact race
 * this function exists to close instead of actually closing it.
 */
export async function waitUntilNotCrawling(sourceId: number, timeoutMs = 5000): Promise<boolean> {
  const pollIntervalMs = 100;
  const deadline = Date.now() + timeoutMs;
  while (isSourceCrawling(sourceId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return !isSourceCrawling(sourceId);
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
    // Also mark the run FAILED rather than leaving it RUNNING forever — if this branch is ever
    // actually hit, the run would otherwise be orphaned with no code path left to close it out.
    logger.error(`executeCrawlRun called for source ${source.id} without a reserved crawl slot`);
    await prisma.crawlRun
      .updateMany({
        where: { id: run.id, status: "RUNNING" },
        data: { status: "FAILED", finishedAt: new Date() },
      })
      .catch(() => {});
    return;
  }

  let vacanciesFound = 0;
  try {
    await logInfo(run.id, `Starting crawl of ${source.name}`);

    const strategy = getStrategy(source);
    if (!strategy) {
      await logWarn(run.id, `crawling not yet implemented for ${source.name}`);
    } else {
      const { vacancies, pageLogs } = await strategy.crawl(source);
      for (const line of pageLogs) {
        await logInfo(run.id, line);
      }

      let upsertedCount = 0;
      for (const vacancy of vacancies) {
        if (runState.cancelled) break;
        await upsertVacancy(vacancy);
        upsertedCount += 1;
      }
      vacanciesFound = upsertedCount;

      if (runState.cancelled) {
        await logInfo(
          run.id,
          `Crawl cancelled after upserting ${upsertedCount}/${vacancies.length} vacancies for ${source.name}`,
        );
      } else {
        await logInfo(run.id, `Found ${vacancies.length} vacancies for ${source.name}`);
      }

      if (!runState.cancelled && strategy.enrichDetails && vacancies.length > 0) {
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
    // Best-effort — if the CrawlRun row itself is gone (e.g. deleted by a concurrent
    // clear-data action while this crawl was still in flight), this write fails too; that's
    // fine, the slot release below (the actual fix for that race) doesn't depend on it.
    await logError(run.id, `Failed to crawl ${source.name}: ${String(error)}`).catch(() => {});
  } finally {
    // Always releases the slot, however this run ends — including if it threw before reaching
    // here (e.g. the very first `logInfo` call above failing with a FK violation because its
    // CrawlRun row was deleted mid-flight). Previously this delete sat *after* the try/catch as
    // a plain statement, so any such early throw skipped it entirely and left the source
    // permanently marked as "crawling" (`isSourceCrawling` stuck `true`) until process restart —
    // reproduced live via a race between a running crawl and a concurrent clear-data call.
    activeRuns.delete(source.id);
  }

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

/**
 * Signals cancellation only — deliberately does NOT release the source's concurrency slot here.
 * `executeCrawlRun` is still running in the background at this point (it only checks `cancelled`
 * between iterations, not instantly), so `isSourceCrawling` must keep reporting `true` until that
 * background task actually finishes and releases the slot itself. Releasing it here instead would
 * let a new crawl (or a `clearSourceData` delete) start concurrently with the still-finishing old
 * run — exactly the race this function exists to prevent.
 */
export function stopCrawlRun(sourceId: number): void {
  const runState = activeRuns.get(sourceId);
  if (!runState) return;
  runState.cancelled = true;
}
