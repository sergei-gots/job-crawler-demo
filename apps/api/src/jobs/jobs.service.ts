import type { CrawlerJob, JobLog } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { ApiError } from "../utils/errors.js";
import type { CreateJobInput } from "./jobs.schemas.js";
import { startMockRun, stopMockRun } from "./jobs.runner.js";

export function listJobs(userId: string): Promise<CrawlerJob[]> {
  return prisma.crawlerJob.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

export async function getJob(
  userId: string,
  id: number,
): Promise<CrawlerJob & { logs: JobLog[] }> {
  const job = await prisma.crawlerJob.findFirst({
    where: { id, userId },
    include: { logs: { orderBy: { createdAt: "asc" } } },
  });
  if (!job) {
    throw new ApiError(404, "Job not found");
  }
  return job;
}

export async function createJob(userId: string, input: CreateJobInput): Promise<CrawlerJob> {
  const sources = await prisma.crawlSource.findMany({ where: { id: { in: input.sources } } });
  if (sources.length !== input.sources.length) {
    throw new ApiError(400, "One or more selected sources do not exist");
  }

  return prisma.crawlerJob.create({
    data: {
      userId,
      name: input.name,
      description: input.description,
      sources: input.sources,
      keywords: input.keywords,
    },
  });
}

async function getOwnedJobOrThrow(userId: string, id: number): Promise<CrawlerJob> {
  const job = await prisma.crawlerJob.findFirst({ where: { id, userId } });
  if (!job) {
    throw new ApiError(404, "Job not found");
  }
  return job;
}

export async function startJob(userId: string, id: number): Promise<CrawlerJob> {
  const job = await getOwnedJobOrThrow(userId, id);

  if (job.status === "RUNNING") {
    throw new ApiError(400, "Job is already running");
  }

  const sourceIds = job.sources as number[];
  const sources = await prisma.crawlSource.findMany({ where: { id: { in: sourceIds } } });

  // Guard the transition with a status-conditioned update, not just the read above: two
  // concurrent start requests (e.g. two tabs) would otherwise both pass the check and both
  // wipe/restart the run. Only the request that actually flips PENDING/COMPLETED/etc. -> RUNNING
  // proceeds to (re)start the mock run.
  const { count } = await prisma.crawlerJob.updateMany({
    where: { id, status: { not: "RUNNING" } },
    data: { status: "RUNNING", lastRunAt: new Date() },
  });
  if (count === 0) {
    throw new ApiError(400, "Job is already running");
  }

  await startMockRun(id, sources);

  return prisma.crawlerJob.findUniqueOrThrow({ where: { id } });
}

export async function stopJob(userId: string, id: number): Promise<CrawlerJob> {
  const job = await getOwnedJobOrThrow(userId, id);

  if (job.status !== "RUNNING") {
    throw new ApiError(400, "Job is not running");
  }

  stopMockRun(id);

  // Same status-conditioned update as startJob: if the mock run's finish timer already flipped
  // the job to COMPLETED between the read above and here, this affects 0 rows and we report
  // "not running" instead of overwriting a completed job with STOPPED.
  const { count } = await prisma.crawlerJob.updateMany({
    where: { id, status: "RUNNING" },
    data: { status: "STOPPED" },
  });
  if (count === 0) {
    throw new ApiError(400, "Job is not running");
  }

  await prisma.jobLog.create({ data: { jobId: id, message: "Stopped by user" } });

  return prisma.crawlerJob.findUniqueOrThrow({ where: { id } });
}
