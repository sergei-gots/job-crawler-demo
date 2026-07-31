import { esClient } from "./esClient.js";

export const CRAWLER_RESULTS_INDEX = "crawler_results";

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
}

let indexEnsured = false;

const CRAWLER_RESULTS_PROPERTIES = {
  sourceId: { type: "integer" as const },
  externalId: { type: "keyword" as const },
  title: { type: "text" as const },
  company: { type: "text" as const },
  url: { type: "keyword" as const },
  postedAt: { type: "date" as const },
  firstSeenAt: { type: "date" as const },
  lastSeenAt: { type: "date" as const },
  description: { type: "text" as const },
  location: { type: "text" as const },
  isRemote: { type: "boolean" as const },
  skillsSummary: { type: "text" as const },
};

/**
 * Creates the index with an explicit mapping on first use. If the index already exists (e.g. a
 * long-running dev/demo instance created it before a later field was added here), applies
 * `putMapping` instead — safe because it only ever adds new fields, it never changes an existing
 * field's type, so this reconciles a pre-existing index with the current schema on every call
 * without needing a separate migration step. A real production deployment with multiple ES
 * versions in the wild would want an explicit mapping-version check instead of doing this on
 * every cold start; not needed for this project's single dev/demo instance.
 */
export async function ensureCrawlerResultsIndex(): Promise<void> {
  if (indexEnsured) return;

  const exists = await esClient.indices.exists({ index: CRAWLER_RESULTS_INDEX });
  if (!exists) {
    await esClient.indices.create({
      index: CRAWLER_RESULTS_INDEX,
      mappings: { properties: CRAWLER_RESULTS_PROPERTIES },
    });
  } else {
    await esClient.indices.putMapping({
      index: CRAWLER_RESULTS_INDEX,
      properties: CRAWLER_RESULTS_PROPERTIES,
    });
  }

  indexEnsured = true;
}

/** Forces the next `ensureCrawlerResultsIndex` call to re-check/recreate the index — call this
 * after deleting the index out-of-band (e.g. an admin "clear search data" action). */
export function resetCrawlerResultsIndexCache(): void {
  indexEnsured = false;
}
