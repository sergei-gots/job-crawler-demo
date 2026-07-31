import { prisma } from "../config/prisma.js";
import { esClient } from "../search/esClient.js";
import {
  CRAWLER_RESULTS_INDEX,
  ensureCrawlerResultsIndex,
  resetCrawlerResultsIndexCache,
} from "../search/crawlerResultsIndex.js";
import { redis } from "../crawler/redisClient.js";
import { stopAndWaitForSource } from "../sources/sources.service.js";

/**
 * Deletes the entire crawled-vacancy corpus (Elasticsearch) and this app's whole
 * `CrawlRun`/`CrawlLog` history (Postgres) — every source goes back to a fresh "never crawled"
 * state, mirroring what `clearSourceData` does for a single source (and for the same reason:
 * leaving stale COMPLETED/STOPPED statuses and vacancy counts around after the data backing them
 * is gone would be misleading). Stops any in-progress crawls first and waits for them to actually
 * finish, via the same `stopAndWaitForSource` `sources.service.ts` uses for one source — run in
 * parallel across all sources here (rather than one at a time) so an admin clearing data while N
 * sources are mid-crawl isn't stuck waiting for each one's stop-and-wind-down sequentially. If any
 * source fails to stop in time, the whole clear aborts rather than deleting data out from under a
 * crawl that's still genuinely running.
 *
 * Recreates the (empty) index immediately after deleting it — rather than leaving it to the next
 * crawl's first upsert via `ensureCrawlerResultsIndex`'s usual lazy path — to avoid a real race
 * observed in testing: a crawl started right after a clear could hit its first `upsertVacancy`
 * before a lazily-created index's shard finished initializing, timing out. `indices.create` itself
 * already waits for the primary shard to become active by default (`wait_for_active_shards: 1`),
 * so no extra polling is needed here.
 */
export async function clearSearchData(): Promise<void> {
  const sources = await prisma.crawlSource.findMany({ select: { id: true } });
  await Promise.all(sources.map(({ id }) => stopAndWaitForSource(id)));

  await esClient.indices.delete({ index: CRAWLER_RESULTS_INDEX }, { ignore: [404] });
  resetCrawlerResultsIndexCache();
  await ensureCrawlerResultsIndex();
  await prisma.crawlRun.deleteMany({});
}

/**
 * Flushes the Redis database backing the rate limiter and page cache. Safe to call anytime —
 * both are pure caches (a cleared rate limiter just means the next crawl request doesn't wait
 * out a stale interval; a cleared page cache just means the next crawl re-fetches instead of
 * reusing a cached page). This Redis instance is dedicated to this app (its own Docker Compose
 * service), so a full flush can't affect unrelated data.
 */
export async function clearCache(): Promise<void> {
  await redis.flushdb();
}
