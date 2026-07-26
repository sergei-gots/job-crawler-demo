import { getJson } from "@/shared/lib/api";
import type { CrawlerJob } from "./crawler-job-types";

export async function getCrawlerJobs(token: string): Promise<CrawlerJob[]> {
  const res = await getJson<{ jobs: CrawlerJob[] }>("/crawler-jobs", token);
  return res.jobs;
}
