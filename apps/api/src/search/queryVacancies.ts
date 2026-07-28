import type { CrawlerJob } from "@prisma/client";
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

/** Raw feed for one source, age-filtered only — not scoped to any one crawler job's keywords. */
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

/**
 * Same underlying data as queryVacanciesForSource, additionally filtered to the crawler job's
 * selected sources and (if present) its keywords — the personalized, per-user view.
 */
export async function queryVacanciesForJob(job: CrawlerJob): Promise<CrawlerResultDoc[]> {
  await ensureCrawlerResultsIndex();

  const sourceIds = job.sources as number[];
  const filter: object[] = [
    { terms: { sourceId: sourceIds } },
    { range: { lastSeenAt: { gte: staleCutoffIso() } } },
  ];

  if (job.keywords) {
    filter.push({ multi_match: { query: job.keywords, fields: ["title", "company", "description"] } });
  }

  const result = await esClient.search<CrawlerResultDoc>({
    index: CRAWLER_RESULTS_INDEX,
    query: { bool: { filter } },
    size: 200,
  });

  return result.hits.hits.map((hit) => hit._source!);
}
