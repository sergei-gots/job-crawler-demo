import { getJson } from "@/shared/lib/api";
import type { CrawlRunWithLogs } from "./crawl-run-types";

export async function getSourceRun(id: number, token: string): Promise<CrawlRunWithLogs | null> {
  const res = await getJson<{ run: CrawlRunWithLogs | null }>(`/sources/${id}/run`, token);
  return res.run;
}
