/*
  Warnings:

  - You are about to drop the `crawler_jobs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `job_logs` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "CrawlStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'STOPPED');

-- DropForeignKey
ALTER TABLE "crawler_jobs" DROP CONSTRAINT "crawler_jobs_userId_fkey";

-- DropForeignKey
ALTER TABLE "job_logs" DROP CONSTRAINT "job_logs_jobId_fkey";

-- DropTable
DROP TABLE "crawler_jobs";

-- DropTable
DROP TABLE "job_logs";

-- DropEnum
DROP TYPE "JobStatus";

-- CreateTable
CREATE TABLE "crawl_runs" (
    "id" SERIAL NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "status" "CrawlStatus" NOT NULL DEFAULT 'PENDING',
    "vacanciesFound" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crawl_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_logs" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crawl_logs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "crawl_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_logs" ADD CONSTRAINT "crawl_logs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "crawl_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
