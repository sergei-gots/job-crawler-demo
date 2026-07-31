import { postJson } from "@/shared/lib/api";
import type { CrawlRun } from "@/entities/source";

export async function startCrawl(id: number, token: string): Promise<CrawlRun> {
  const res = await postJson<{ run: CrawlRun }>(`/sources/${id}/crawl`, {}, token);
  return res.run;
}
