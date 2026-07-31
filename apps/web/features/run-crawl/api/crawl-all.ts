import { postJson } from "@/shared/lib/api";
import type { CrawlRun } from "@/entities/source";

export async function crawlAll(token: string): Promise<CrawlRun[]> {
  const res = await postJson<{ runs: CrawlRun[] }>("/sources/crawl-all", {}, token);
  return res.runs;
}
