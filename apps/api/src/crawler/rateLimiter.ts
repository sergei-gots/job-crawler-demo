import { redis } from "./redisClient.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Added on top of every wait, never subtracted - a perfectly regular request interval is itself
// a bot signal (no real client, automated or human, hits an endpoint at millisecond-perfect
// intervals). Purely additive by design: it can only make a crawl more polite (longer gaps),
// never undercut the source's configured defaultDelayMs, so it needs no clamping regardless of
// how small defaultDelayMs is.
const MAX_JITTER_MS = 7000;

function withJitter(delayMs: number): number {
  return delayMs + Math.floor(Math.random() * (MAX_JITTER_MS + 1));
}

/**
 * Waits until at least `delayMs` plus a random 0-7s jitter has passed since the last fetch for
 * this source, then records the current fetch. Shared across concurrent crawler jobs via the
 * `rate:source:{sourceId}` key so two jobs hitting the same source don't exceed that source's
 * courtesy delay between them.
 */
export async function waitForSlot(sourceId: number, delayMs: number): Promise<void> {
  const key = `rate:source:${sourceId}`;
  const jitteredDelayMs = withJitter(delayMs);
  const lastFetchedAt = await redis.get(key);

  if (lastFetchedAt) {
    const elapsed = Date.now() - Number(lastFetchedAt);
    const remaining = jitteredDelayMs - elapsed;
    if (remaining > 0) {
      await sleep(remaining);
    }
  }

  await redis.set(key, Date.now().toString(), "PX", jitteredDelayMs);
}
