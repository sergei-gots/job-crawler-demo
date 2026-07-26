import { postJson } from "@/shared/lib/api";
import type { CrawlerJob } from "@/entities/crawler-job";

export async function stopCrawlerJob(id: number, token: string): Promise<CrawlerJob> {
  const res = await postJson<{ job: CrawlerJob }>(`/crawler-jobs/${id}/stop`, {}, token);
  return res.job;
}
