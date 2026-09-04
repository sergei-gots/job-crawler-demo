import { postJson } from "@/shared/lib/api";
import type { CrawlRun } from "@/entities/source";

export async function stopListingCrawl(
  sourceId: number,
  listingId: number,
  token: string,
): Promise<CrawlRun> {
  const res = await postJson<{ run: CrawlRun }>(
    `/sources/${sourceId}/listings/${listingId}/crawl/stop`,
    {},
    token,
  );
  return res.run;
}
