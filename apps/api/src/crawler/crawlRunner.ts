import type { CrawlListing, CrawlRun, CrawlSource } from "@prisma/client";
import { getStrategy } from "./index.js";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { upsertVacancy } from "../search/upsertVacancy.js";

interface RunState {
  cancelled: boolean;
}

/**
 * A source without listings crawls as one unit, so its slot key is just its sourceId. A source
 * with listings (see .claude/features/09_FEATURE_CRAWL_LISTINGS.md) crawls at the listing level,
 * so each listing gets its own independent slot — otherwise crawling one WeWorkRemotely listing
 * would block starting another, which is not how they're related.
 */
function slotKeyFor(sourceId: number, listingId: number | null): number | string {
  return listingId ?? sourceId;
}

// Keyed by slotKeyFor(sourceId, listingId), not runId — at most one run is active per slot at a
// time (see reserveCrawlSlot).
const activeRuns = new Map<number | string, RunState>();

export function isSlotCrawling(sourceId: number, listingId: number | null = null): boolean {
  return activeRuns.has(slotKeyFor(sourceId, listingId));
}

/**
 * Reserves the concurrency slot synchronously (no `await` between the caller's `isSlotCrawling`
 * check and this call), so two near-simultaneous crawl requests for the same slot can't both pass
 * the check — Node's single-threaded event loop makes the pair atomic. Callers must
 * `releaseCrawlSlot` if they fail before reaching `executeCrawlRun`.
 */
export function reserveCrawlSlot(sourceId: number, listingId: number | null = null): void {
  activeRuns.set(slotKeyFor(sourceId, listingId), { cancelled: false });
}

export function releaseCrawlSlot(sourceId: number, listingId: number | null = null): void {
  activeRuns.delete(slotKeyFor(sourceId, listingId));
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
export async function waitUntilNotCrawling(
  sourceId: number,
  listingId: number | null = null,
  timeoutMs = 5000,
): Promise<boolean> {
  const pollIntervalMs = 100;
  const deadline = Date.now() + timeoutMs;
  while (isSlotCrawling(sourceId, listingId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return !isSlotCrawling(sourceId, listingId);
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
 * and reserved the slot via `reserveCrawlSlot` (see `sources.service.ts`'s `startSourceCrawl`/
 * `startListingCrawl`) before calling this, fire-and-forget. `listing` is `null` for sources
 * without listings (crawl exactly as before); passed through to the strategy otherwise.
 */
export async function executeCrawlRun(
  run: CrawlRun,
  source: CrawlSource,
  listing: CrawlListing | null = null,
): Promise<void> {
  const runState = activeRuns.get(slotKeyFor(source.id, listing?.id ?? null));
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
  let failed = false;
  try {
    await logInfo(run.id, `Starting crawl of ${source.name}`);

    const strategy = getStrategy(source);
    if (!strategy) {
      await logWarn(run.id, `crawling not yet implemented for ${source.name}`);
    } else {
      const { vacancies, pageLogs } = await strategy.crawl(source, listing);
      for (const line of pageLogs) {
        await logInfo(run.id, line);
      }

      let upsertedCount = 0;
      for (const vacancy of vacancies) {
        if (runState.cancelled) break;
        await upsertVacancy(vacancy, listing?.id ?? null);
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
          listing,
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
    failed = true;
    logger.error(`Failed to crawl source ${source.name} (run ${run.id}): ${String(error)}`);
    // Best-effort — if the CrawlRun row itself is gone (e.g. deleted by a concurrent
    // clear-data action while this crawl was still in flight), this write fails too; that's
    // fine, the slot release below (the actual fix for that race) doesn't depend on it.
    await logError(run.id, `Failed to crawl ${source.name}: ${String(error)}`).catch(() => {});
  } finally {
    // Always releases the slot, however this run ends — including if it threw before reaching
    // here (e.g. the very first `logInfo` call above failing with a FK violation because its
    // CrawlRun row was deleted mid-flight). Previously this delete sat *after* the try/catch as
    // a plain statement, so any such early throw skipped it entirely and left the slot
    // permanently marked as "crawling" (`isSlotCrawling` stuck `true`) until process restart —
    // reproduced live via a race between a running crawl and a concurrent clear-data call.
    activeRuns.delete(slotKeyFor(source.id, listing?.id ?? null));
  }

  // If stopped by the user mid-run, stopCrawlRun already flipped RUNNING -> STOPPED and wrote its
  // own CrawlLog line — don't also try to complete the run.
  if (runState.cancelled) return;

  try {
    // Status-conditioned update: if the run was already stopped right as the crawl above
    // finished, this affects 0 rows and we skip appending a "Crawl completed"/"Crawl failed" log
    // that would contradict the STOPPED status. `failed` (set in the catch block above) decides
    // FAILED vs COMPLETED - previously this always wrote COMPLETED regardless of whether the try
    // block threw, silently overwriting a real failure (already logged via logError above) with a
    // success status one line later.
    const { count } = await prisma.crawlRun.updateMany({
      where: { id: run.id, status: "RUNNING" },
      data: failed
        ? { status: "FAILED", finishedAt: new Date(), vacanciesFound }
        : { status: "COMPLETED", finishedAt: new Date(), vacanciesFound },
    });
    if (count > 0 && !failed) {
      await logInfo(run.id, "Crawl completed");
    }
  } catch (error) {
    logger.error(`Failed to finish crawl run ${run.id}: ${String(error)}`);
  }
}

/**
 * Signals cancellation only — deliberately does NOT release the slot here. `executeCrawlRun` is
 * still running in the background at this point (it only checks `cancelled` between iterations,
 * not instantly), so `isSlotCrawling` must keep reporting `true` until that background task
 * actually finishes and releases the slot itself. Releasing it here instead would let a new crawl
 * (or a `clearSourceData` delete) start concurrently with the still-finishing old run — exactly
 * the race this function exists to prevent.
 */
export function stopCrawlRun(sourceId: number, listingId: number | null = null): void {
  const runState = activeRuns.get(slotKeyFor(sourceId, listingId));
  if (!runState) return;
  runState.cancelled = true;
}
