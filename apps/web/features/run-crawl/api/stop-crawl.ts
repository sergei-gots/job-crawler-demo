import { postJson } from "@/shared/lib/api";
import type { CrawlRun } from "@/entities/source";

export async function stopCrawl(id: number, token: string): Promise<CrawlRun> {
  const res = await postJson<{ run: CrawlRun }>(`/sources/${id}/crawl/stop`, {}, token);
  return res.run;
}
