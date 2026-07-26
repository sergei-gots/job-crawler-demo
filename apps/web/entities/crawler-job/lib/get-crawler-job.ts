import { getJson } from "@/shared/lib/api";
import type { CrawlerJobWithLogs } from "./crawler-job-types";

export async function getCrawlerJob(id: number, token: string): Promise<CrawlerJobWithLogs> {
  const res = await getJson<{ job: CrawlerJobWithLogs }>(`/crawler-jobs/${id}`, token);
  return res.job;
}
