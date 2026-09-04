import { getJson } from "@/shared/lib/api";
import type { CrawlRunWithLogs } from "./crawl-run-types";

export async function getListingRun(
  sourceId: number,
  listingId: number,
  token: string,
): Promise<CrawlRunWithLogs | null> {
  const res = await getJson<{ run: CrawlRunWithLogs | null }>(
    `/sources/${sourceId}/listings/${listingId}/run`,
    token,
  );
  return res.run;
}
