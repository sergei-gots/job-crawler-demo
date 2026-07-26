import type { RawVacancy } from "../crawler/types.js";
import { CRAWLER_RESULTS_INDEX, ensureCrawlerResultsIndex } from "./crawlerResultsIndex.js";
import { esClient } from "./esClient.js";

/**
 * Upserts by a deterministic id (`sourceId:externalId`) so a vacancy re-seen on a later crawl —
 * possibly by a different user's crawler job — updates `lastSeenAt` instead of duplicating.
 * `firstSeenAt` is only set on the initial insert.
 */
export async function upsertVacancy(raw: RawVacancy): Promise<void> {
  await ensureCrawlerResultsIndex();

  const id = `${raw.sourceId}:${raw.externalId}`;
  const now = new Date().toISOString();

  await esClient.update({
    index: CRAWLER_RESULTS_INDEX,
    id,
    doc: {
      sourceId: raw.sourceId,
      externalId: raw.externalId,
      title: raw.title,
      company: raw.company,
      url: raw.url,
      postedAt: raw.postedAt,
      lastSeenAt: now,
    },
    upsert: {
      sourceId: raw.sourceId,
      externalId: raw.externalId,
      title: raw.title,
      company: raw.company,
      url: raw.url,
      postedAt: raw.postedAt,
      firstSeenAt: now,
      lastSeenAt: now,
    },
  });
}
