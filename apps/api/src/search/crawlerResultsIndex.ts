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
}

let indexEnsured = false;

/** Creates the index with an explicit mapping on first use; a no-op if it already exists. */
export async function ensureCrawlerResultsIndex(): Promise<void> {
  if (indexEnsured) return;

  const exists = await esClient.indices.exists({ index: CRAWLER_RESULTS_INDEX });
  if (!exists) {
    await esClient.indices.create({
      index: CRAWLER_RESULTS_INDEX,
      mappings: {
        properties: {
          sourceId: { type: "integer" },
          externalId: { type: "keyword" },
          title: { type: "text" },
          company: { type: "text" },
          url: { type: "keyword" },
          postedAt: { type: "date" },
          firstSeenAt: { type: "date" },
          lastSeenAt: { type: "date" },
        },
      },
    });
  }

  indexEnsured = true;
}
