import type { CrawlSource } from "@prisma/client";
import { getStrategy } from "../crawler/index.js";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { upsertVacancy } from "../search/upsertVacancy.js";

interface RunState {
  cancelled: boolean;
}

const activeRuns = new Map<number, RunState>();

async function logInfo(jobId: number, message: string): Promise<void> {
  await prisma.jobLog.create({ data: { jobId, message } });
}

async function logWarn(jobId: number, message: string): Promise<void> {
  await prisma.jobLog.create({ data: { jobId, level: "WARN", message } });
}

async function logError(jobId: number, message: string): Promise<void> {
  await prisma.jobLog.create({ data: { jobId, level: "ERROR", message } });
}

async function crawlSource(jobId: number, source: CrawlSource, isCancelled: () => boolean): Promise<void> {
  await logInfo(jobId, `Starting crawl of ${source.name}`);

  const strategy = getStrategy(source);
  if (!strategy) {
    await logWarn(jobId, `crawling not yet implemented for ${source.name}`);
    return;
  }

  const { vacancies, pageLogs } = await strategy.crawl(source);
  for (const line of pageLogs) {
    await logInfo(jobId, line);
  }
  for (const vacancy of vacancies) {
    await upsertVacancy(vacancy);
  }
  await logInfo(jobId, `Found ${vacancies.length} vacancies for ${source.name}`);

  if (strategy.enrichDetails && vacancies.length > 0) {
    await logInfo(jobId, `Enriching vacancy details for ${source.name} (${vacancies.length} vacancies)`);
    const { enrichedCount } = await strategy.enrichDetails(source, vacancies, isCancelled, (message, level) => {
      if (level === "ERROR") return logError(jobId, message);
      if (level === "WARN") return logWarn(jobId, message);
      return logInfo(jobId, message);
    });
    await logInfo(jobId, `Enriched ${enrichedCount}/${vacancies.length} vacancies for ${source.name}`);
  }
}

export async function startCrawlerRun(jobId: number, sources: CrawlSource[]): Promise<void> {
  stopCrawlerRun(jobId);

  await prisma.jobLog.deleteMany({ where: { jobId } });

  const runState: RunState = { cancelled: false };
  activeRuns.set(jobId, runState);

  await logInfo(jobId, "Crawler job started");

  for (const source of sources) {
    if (runState.cancelled) break;

    try {
      await crawlSource(jobId, source, () => runState.cancelled);
    } catch (error) {
      logger.error(`Failed to crawl source ${source.name} for job ${jobId}: ${String(error)}`);
      await logError(jobId, `Failed to crawl ${source.name}: ${String(error)}`);
    }
  }

  activeRuns.delete(jobId);

  // If stopped by the user mid-run, stopCrawlerRun already flipped RUNNING -> STOPPED and wrote its
  // own JobLog line — don't also try to complete the job.
  if (runState.cancelled) return;

  try {
    // Status-conditioned update, mirroring stopJob's own conditioned write: if the job was
    // already stopped by the user right as the loop above finished, this affects 0 rows and we
    // skip appending a "Crawler job completed" log that would contradict the STOPPED status.
    const { count } = await prisma.crawlerJob.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: { status: "COMPLETED" },
    });
    if (count > 0) {
      await logInfo(jobId, "Crawler job completed");
    }
  } catch (error) {
    logger.error(`Failed to finish crawler job run: ${String(error)}`);
  }
}

export function stopCrawlerRun(jobId: number): void {
  const runState = activeRuns.get(jobId);
  if (!runState) return;
  runState.cancelled = true;
  activeRuns.delete(jobId);
}
