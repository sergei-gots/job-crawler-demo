import type { RawVacancy } from "../crawler/types.js";
import { CRAWLER_RESULTS_INDEX, ensureCrawlerResultsIndex } from "./crawlerResultsIndex.js";
import { esClient } from "./esClient.js";

/**
 * Upserts by a deterministic id (`sourceId:externalId`) so a vacancy re-seen on a later crawl —
 * possibly by a different user's crawler job — updates `lastSeenAt` instead of duplicating.
 * `firstSeenAt` is only set on the initial insert. `listingId` (Increment 9) is best-effort,
 * not part of the dedup key — see `CRAWLER_RESULTS_SCHEMA_VERSION`'s v4 note: a vacancy that
 * appears in more than one of a source's listings ends up attributed to whichever crawled it
 * last, since the underlying record is genuinely one shared vacancy, not one per listing.
 */
export async function upsertVacancy(raw: RawVacancy, listingId: number | null = null): Promise<void> {
  await ensureCrawlerResultsIndex();

  const id = `${raw.sourceId}:${raw.externalId}`;
  const now = new Date().toISOString();

  // Detail fields are only included when present on `raw`, so a listing-only upsert never
  // clobbers detail data written by a later enrichDetails pass (and vice versa).
  const detailFields = {
    ...(raw.description !== undefined ? { description: raw.description } : {}),
    ...(raw.location !== undefined ? { location: raw.location } : {}),
    ...(raw.isRemote !== undefined ? { isRemote: raw.isRemote } : {}),
    ...(raw.skillsSummary !== undefined ? { skillsSummary: raw.skillsSummary } : {}),
    ...(raw.specialization !== undefined ? { specialization: raw.specialization } : {}),
    ...(raw.seniority !== undefined ? { seniority: raw.seniority } : {}),
  };

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
      listingId,
      ...detailFields,
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
      listingId,
      ...detailFields,
    },
  });
}
