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
    prisma.jobLog
      .create({ data: { jobId, message } })
      .catch((error: unknown) => logger.error(`Failed to write job log: ${String(error)}`));
  }, delayMs);
  timers.push(timer);
}

export async function startMockRun(jobId: number, sourceNames: string[]): Promise<void> {
  stopMockRun(jobId);

  await prisma.jobLog.deleteMany({ where: { jobId } });

  const timers: NodeJS.Timeout[] = [];
  let step = 0;
  const stepMs = 1200;

  scheduleLog(jobId, (step += 1) * stepMs, "Job started", timers);
  for (const sourceName of sourceNames) {
    scheduleLog(jobId, (step += 1) * stepMs, `Fetching ${sourceName}...`, timers);
    scheduleLog(jobId, (step += 1) * stepMs, `Parsed postings from ${sourceName}`, timers);
  }

  const finishTimer = setTimeout(
    () => {
      prisma.jobLog
        .create({ data: { jobId, message: "Job completed" } })
        .then(() => prisma.crawlerJob.update({ where: { id: jobId }, data: { status: "COMPLETED" } }))
        .catch((error: unknown) => logger.error(`Failed to finish mock job run: ${String(error)}`))
        .finally(() => activeTimers.delete(jobId));
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
