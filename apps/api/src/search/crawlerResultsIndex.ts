import { logger } from "../config/logger.js";
import { esClient } from "./esClient.js";

export const CRAWLER_RESULTS_INDEX = "crawler_results";

/**
 * Bump this whenever `CRAWLER_RESULTS_PROPERTIES` changes in a way existing indexed docs won't
 * satisfy (new field, changed sub-field, changed type). It's stamped into the index mapping's
 * `_meta` on creation; `ensureCrawlerResultsIndex` compares the live index's stored version
 * against this and rebuilds the index on a mismatch — see that function's doc comment.
 *
 * History: v1 = original mapping; v2 = added `company.keyword`/`location.keyword` sub-fields and
 * the `specialization`/`seniority` keyword fields (Increment 3b faceted search); v3 = added
 * `title.suggest`/`company.suggest` (lowercase-normalized keyword sub-fields) for the Increment 3c
 * autocomplete suggestions endpoint; v4 = added `listingId` (Increment 9) — best-effort, not part
 * of the dedup key (`sourceId:externalId` stays source-wide, see CrawlListing decisions in
 * `.claude/features/09_FEATURE_CRAWL_LISTINGS.md`): records whichever listing most recently
 * upserted this vacancy, so a posting that appears in two listings shows under whichever crawled
 * it last, not both.
 */
export const CRAWLER_RESULTS_SCHEMA_VERSION = 4;

export interface CrawlerResultDoc {
  sourceId: number;
  externalId: string;
  title: string;
  company: string | null;
  url: string;
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  description?: string | null;
  location?: string | null;
  isRemote?: boolean | null;
  skillsSummary?: string | null;
  specialization?: string | null;
  seniority?: string | null;
  /** Best-effort: which CrawlListing most recently upserted this vacancy; null for sources/runs
   * without a listing. Not part of the dedup key — see schema version history above. */
  listingId?: number | null;
}

let indexEnsured = false;

// A lowercase-only normalizer (no tokenization) for the `.suggest` sub-fields below — lets
// autocomplete prefix-match case-insensitively while still aggregating on whole, exact values
// (unlike a `text` analyzer, which would tokenize "Job Crawler" into separate "job"/"crawler"
// terms and break whole-value prefix suggestions).
const CRAWLER_RESULTS_SETTINGS = {
  analysis: {
    normalizer: {
      lowercase_normalizer: { type: "custom" as const, filter: ["lowercase"] },
    },
  },
};

// `location`/`company` carry a `.keyword` sub-field so they stay full-text-searchable (the base
// `text` field, used by `multi_match`) while also being aggregatable for facets (the `keyword`
// sub-field, used by `terms` aggregations) — a plain `text` field can't be aggregated directly.
// `title`/`company` additionally carry a `.suggest` sub-field (Increment 3c) — a *separate*
// keyword sub-field from `.keyword`, normalized lowercase for case-insensitive autocomplete
// prefix matching. It's kept apart from `company.keyword` deliberately: that field drives the
// Company facet's exact filter/display and must stay original-case, so lowercasing it in place
// would corrupt the facet.
const CRAWLER_RESULTS_PROPERTIES = {
  sourceId: { type: "integer" as const },
  externalId: { type: "keyword" as const },
  title: {
    type: "text" as const,
    fields: { suggest: { type: "keyword" as const, normalizer: "lowercase_normalizer" } },
  },
  company: {
    type: "text" as const,
    fields: {
      keyword: { type: "keyword" as const },
      suggest: { type: "keyword" as const, normalizer: "lowercase_normalizer" },
    },
  },
  url: { type: "keyword" as const },
  postedAt: { type: "date" as const },
  firstSeenAt: { type: "date" as const },
  lastSeenAt: { type: "date" as const },
  description: { type: "text" as const },
  location: { type: "text" as const, fields: { keyword: { type: "keyword" as const } } },
  isRemote: { type: "boolean" as const },
  skillsSummary: { type: "text" as const },
  specialization: { type: "keyword" as const },
  seniority: { type: "keyword" as const },
  listingId: { type: "integer" as const },
};

async function createCrawlerResultsIndex(): Promise<void> {
  await esClient.indices.create({
    index: CRAWLER_RESULTS_INDEX,
    settings: CRAWLER_RESULTS_SETTINGS,
    mappings: {
      _meta: { schemaVersion: CRAWLER_RESULTS_SCHEMA_VERSION },
      properties: CRAWLER_RESULTS_PROPERTIES,
    },
  });
}

/** Reads the schema version stamped into the live index's mapping `_meta`, or `null` if the
 * index predates versioning (created before `_meta.schemaVersion` was written). */
async function readLiveSchemaVersion(): Promise<number | null> {
  const mapping = await esClient.indices.getMapping({ index: CRAWLER_RESULTS_INDEX });
  const meta = mapping[CRAWLER_RESULTS_INDEX]?.mappings?._meta as
    | { schemaVersion?: unknown }
    | undefined;
  return typeof meta?.schemaVersion === "number" ? meta.schemaVersion : null;
}

/**
 * Ensures the `crawler_results` index exists at the current schema version.
 *
 * Elasticsearch here is a derived cache, not the source of truth — every vacancy is re-fetchable
 * by re-crawling (upserts are idempotent by `sourceId:externalId`). So instead of a
 * production-grade zero-downtime reindex (copy into a new index + alias swap), we take the
 * simple route the data model allows: on a schema-version mismatch we delete and recreate the
 * index empty, then let the normal crawl process repopulate it. This is safe because it touches
 * only the ES index — crawl history (`CrawlRun`/`CrawlLog`) and all other DB records are left
 * untouched. The version is stored in the index mapping's `_meta`, so a stale index (including
 * one created before versioning, which reads as `null`) triggers exactly one rebuild.
 */
export async function ensureCrawlerResultsIndex(): Promise<void> {
  if (indexEnsured) return;

  const exists = await esClient.indices.exists({ index: CRAWLER_RESULTS_INDEX });
  if (exists) {
    const liveVersion = await readLiveSchemaVersion();
    if (liveVersion === CRAWLER_RESULTS_SCHEMA_VERSION) {
      indexEnsured = true;
      return;
    }
    logger.warn(
      `[search] crawler_results schema version ${liveVersion ?? "unversioned"} != ` +
        `${CRAWLER_RESULTS_SCHEMA_VERSION}; rebuilding index. Crawl history and DB records are ` +
        `untouched — re-crawl (per source or "crawl all") to repopulate search data.`,
    );
    await esClient.indices.delete({ index: CRAWLER_RESULTS_INDEX }, { ignore: [404] });
  }

  await createCrawlerResultsIndex();
  logger.info(
    `[search] crawler_results index ready at schema version ${CRAWLER_RESULTS_SCHEMA_VERSION}.`,
  );
  indexEnsured = true;
}

/** Forces the next `ensureCrawlerResultsIndex` call to re-check/recreate the index — call this
 * after deleting the index out-of-band (e.g. an admin "clear search data" action). */
export function resetCrawlerResultsIndexCache(): void {
  indexEnsured = false;
}
