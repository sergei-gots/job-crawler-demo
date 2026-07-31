import { CRAWLER_RESULTS_INDEX, ensureCrawlerResultsIndex, type CrawlerResultDoc } from "./crawlerResultsIndex.js";
import { esClient } from "./esClient.js";

function maxVacancyAgeDays(): number {
  return Number(process.env.MAX_VACANCY_AGE_DAYS ?? 14);
}

function staleCutoffIso(): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxVacancyAgeDays());
  return cutoff.toISOString();
}

/**
 * Raw feed for one source, age-filtered only. A global, keyword+facet search across every
 * source's vacancies is planned for Increment 3b — see
 * `.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md`.
 */
export async function queryVacanciesForSource(sourceId: number): Promise<CrawlerResultDoc[]> {
  await ensureCrawlerResultsIndex();

  const result = await esClient.search<CrawlerResultDoc>({
    index: CRAWLER_RESULTS_INDEX,
    query: {
      bool: {
        filter: [
          { term: { sourceId } },
          { range: { lastSeenAt: { gte: staleCutoffIso() } } },
        ],
      },
    },
    size: 200,
  });

  return result.hits.hits.map((hit) => hit._source!);
}
