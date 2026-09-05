import { createHash } from "node:crypto";
import { redis } from "./redisClient.js";

// Vacancy listings and detail pages don't change minute-to-minute, and this cache exists to
// spare the source from duplicate/near-simultaneous requests (not to guarantee freshness) — an
// hour covers a full habr_career run (listing + all detail fetches, ~15 min at the seeded 12s
// rate limit), so a re-run shortly after mostly hits cache instead of re-fetching everything.
const PAGE_CACHE_TTL_SECONDS = 3600;

export interface CachedPage {
  html: string;
  cacheHit: boolean;
}

function cacheKeyFor(sourceId: number, pageUrl: string): string {
  const urlHash = createHash("sha1").update(pageUrl).digest("hex");
  return `page:raw:${sourceId}:${urlHash}`;
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
  const key = cacheKeyFor(sourceId, pageUrl);

  const cached = await redis.get(key);
  if (cached !== null) {
    return { html: cached, cacheHit: true };
  }

  const html = await fetchFn();
  await redis.set(key, html, "EX", PAGE_CACHE_TTL_SECONDS);
  return { html, cacheHit: false };
}

/**
 * Deletes one page's cache entry, keyed exactly the way `getOrFetch` computes it - lets a caller
 * that already knows a specific set of URLs (e.g. one listing's own page plus its vacancies'
 * detail pages) evict just those, without the global "Clear cache" admin action's `redis.flushdb`
 * (which would also drop every other source/listing's cache and the rate limiter's state).
 */
export async function deleteCachedPage(sourceId: number, pageUrl: string): Promise<void> {
  await redis.del(cacheKeyFor(sourceId, pageUrl));
}
