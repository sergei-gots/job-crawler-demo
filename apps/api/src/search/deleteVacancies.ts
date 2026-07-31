import { CRAWLER_RESULTS_INDEX, ensureCrawlerResultsIndex } from "./crawlerResultsIndex.js";
import { esClient } from "./esClient.js";

/** `refresh: true` makes the deletion visible to an immediately-following search/count — without
 * it, ES's near-real-time refresh interval could show stale (already-deleted) docs briefly. */
export async function deleteVacanciesForSource(sourceId: number): Promise<void> {
  await ensureCrawlerResultsIndex();
  await esClient.deleteByQuery(
    { index: CRAWLER_RESULTS_INDEX, query: { term: { sourceId } }, refresh: true },
    { ignore: [404] },
  );
}
