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
      config: input.config,
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

  const sourceIds = job.sources as number[];
  const sources = await prisma.crawlSource.findMany({ where: { id: { in: sourceIds } } });
  const sourceNames = sources.map((source) => source.name);

  const updated = await prisma.crawlerJob.update({
    where: { id },
    data: { status: "RUNNING", lastRunAt: new Date() },
  });

  await startMockRun(id, sourceNames);

  return updated;
}

export async function stopJob(userId: string, id: number): Promise<CrawlerJob> {
  const job = await getOwnedJobOrThrow(userId, id);

  if (job.status !== "RUNNING") {
    throw new ApiError(400, "Job is not running");
  }

  stopMockRun(id);
  await prisma.jobLog.create({ data: { jobId: id, message: "Stopped by user" } });

  return prisma.crawlerJob.update({ where: { id }, data: { status: "FAILED" } });
}
