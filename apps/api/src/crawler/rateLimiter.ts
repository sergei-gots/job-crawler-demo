import { redis } from "./redisClient.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits until at least `delayMs` has passed since the last fetch for this source, then records
 * the current fetch. Shared across concurrent crawler jobs via the `rate:source:{sourceId}` key
 * so two jobs hitting the same source don't exceed that source's courtesy delay between them.
 */
export async function waitForSlot(sourceId: number, delayMs: number): Promise<void> {
  const key = `rate:source:${sourceId}`;
  const lastFetchedAt = await redis.get(key);

  if (lastFetchedAt) {
    const elapsed = Date.now() - Number(lastFetchedAt);
    const remaining = delayMs - elapsed;
    if (remaining > 0) {
      await sleep(remaining);
    }
  }

  await redis.set(key, Date.now().toString(), "PX", delayMs);
}
