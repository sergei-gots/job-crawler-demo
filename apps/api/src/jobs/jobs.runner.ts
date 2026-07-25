import type { CrawlSource } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";

/**
 * Stub crawler runner for this increment: no real crawling, Redis, or Puppeteer/Cheerio yet.
 * It simulates progress by writing JobLog rows on a timer and flipping the job status when done.
 * To be replaced by the real crawler/queue in a later increment.
 */

const activeTimers = new Map<number, NodeJS.Timeout[]>();

function scheduleLog(jobId: number, delayMs: number, message: string, timers: NodeJS.Timeout[]): void {
  const timer = setTimeout(() => {
    void (async () => {
      try {
        await prisma.jobLog.create({ data: { jobId, message } });
      } catch (error) {
        logger.error(`Failed to write job log: ${String(error)}`);
      }
    })();
  }, delayMs);
  timers.push(timer);
}

export async function startMockRun(jobId: number, sources: CrawlSource[]): Promise<void> {
  stopMockRun(jobId);

  await prisma.jobLog.deleteMany({ where: { jobId } });

  const timers: NodeJS.Timeout[] = [];
  let step = 0;
  const stepMs = 1200;

  scheduleLog(jobId, (step += 1) * stepMs, "Job started", timers);
  for (const source of sources) {
    // The mock timer cadence stays fixed (stepMs) so demo runs finish quickly; the source's
    // own type/defaultDelayMs are surfaced here to show they drive per-source crawl behavior
    // rather than any job-level setting, which no longer exists.
    const strategy = source.type === "DYNAMIC" ? "puppeteer" : "axios";
    scheduleLog(
      jobId,
      (step += 1) * stepMs,
      `Fetching ${source.name} (${strategy}, ${source.defaultDelayMs}ms delay)...`,
      timers,
    );
    scheduleLog(jobId, (step += 1) * stepMs, `Parsed postings from ${source.name}`, timers);
  }

  const finishTimer = setTimeout(
    () => {
      void (async () => {
        try {
          // Status-conditioned update, mirroring stopJob's own conditioned write: if the job was
          // already stopped by the user before this timer fired, this affects 0 rows and we skip
          // appending a "Job completed" log that would contradict the STOPPED status.
          const { count } = await prisma.crawlerJob.updateMany({
            where: { id: jobId, status: "RUNNING" },
            data: { status: "COMPLETED" },
          });
          if (count > 0) {
            await prisma.jobLog.create({ data: { jobId, message: "Job completed" } });
          }
        } catch (error) {
          logger.error(`Failed to finish mock job run: ${String(error)}`);
        } finally {
          activeTimers.delete(jobId);
        }
      })();
    },
    (step += 1) * stepMs,
  );
  timers.push(finishTimer);

  activeTimers.set(jobId, timers);
}

export function stopMockRun(jobId: number): void {
  const timers = activeTimers.get(jobId);
  if (!timers) return;
  for (const timer of timers) clearTimeout(timer);
  activeTimers.delete(jobId);
}
