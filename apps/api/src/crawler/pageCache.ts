import { createHash } from "node:crypto";
import { redis } from "./redisClient.js";

const PAGE_CACHE_TTL_SECONDS = 300;

export interface CachedPage {
  html: string;
  cacheHit: boolean;
}

/**
 * Returns the cached HTML for this source/page if present (skipping `fetchFn` and the rate
 * limiter entirely, since no new outbound request happens), otherwise fetches, caches, and
 * returns it. Shared across concurrent crawler jobs targeting the same source/page.
 */
export async function getOrFetch(
  sourceId: number,
  pageUrl: string,
  fetchFn: () => Promise<string>,
): Promise<CachedPage> {
  const urlHash = createHash("sha1").update(pageUrl).digest("hex");
  const key = `page:raw:${sourceId}:${urlHash}`;

  const cached = await redis.get(key);
  if (cached !== null) {
    return { html: cached, cacheHit: true };
  }

  const html = await fetchFn();
  await redis.set(key, html, "EX", PAGE_CACHE_TTL_SECONDS);
  return { html, cacheHit: false };
}
