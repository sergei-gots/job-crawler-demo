import type { QueryDslQueryContainer, AggregationsStringTermsAggregate } from "@elastic/elasticsearch/lib/api/types.js";
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

export interface VacancySearchFilters {
  q?: string;
  specialization?: string[];
  seniority?: string[];
  isRemote?: boolean[];
  location?: string[];
  company?: string[];
}

export interface FacetBucket {
  value: string;
  count: number;
}

export interface VacancySearchResult {
  hits: CrawlerResultDoc[];
  facets: {
    specialization: FacetBucket[];
    seniority: FacetBucket[];
    isRemote: FacetBucket[];
    location: FacetBucket[];
    company: FacetBucket[];
  };
}

const FACET_FIELDS = {
  specialization: "specialization",
  seniority: "seniority",
  isRemote: "isRemote",
  location: "location.keyword",
  company: "company.keyword",
} as const;

const FACET_AGG_SIZE = 20;

/**
 * Known simplification (flagged per the Phase 3b design doc, not a bug): every facet's bucket
 * counts are computed against the *same* filtered set (including that facet's own active
 * selection), rather than each facet excluding its own filter via `post_filter`/filtered aggs.
 * Proper faceted navigation would let you see "how many more results if I add this option" per
 * facet; this MVP version shows "how many results the current selection already has" instead.
 */
export async function searchVacancies(filters: VacancySearchFilters): Promise<VacancySearchResult> {
  await ensureCrawlerResultsIndex();

  const filter: QueryDslQueryContainer[] = [{ range: { lastSeenAt: { gte: staleCutoffIso() } } }];
  if (filters.specialization?.length) filter.push({ terms: { specialization: filters.specialization } });
  if (filters.seniority?.length) filter.push({ terms: { seniority: filters.seniority } });
  if (filters.isRemote?.length) filter.push({ terms: { isRemote: filters.isRemote } });
  if (filters.location?.length) filter.push({ terms: { "location.keyword": filters.location } });
  if (filters.company?.length) filter.push({ terms: { "company.keyword": filters.company } });

  const must: QueryDslQueryContainer[] = filters.q
    ? [{ multi_match: { query: filters.q, fields: ["title", "company", "description"] } }]
    : [];

  const result = await esClient.search<CrawlerResultDoc, Record<keyof typeof FACET_FIELDS, AggregationsStringTermsAggregate>>({
    index: CRAWLER_RESULTS_INDEX,
    query: { bool: { filter, must } },
    size: 200,
    aggregations: Object.fromEntries(
      Object.entries(FACET_FIELDS).map(([name, field]) => [
        name,
        { terms: { field, size: FACET_AGG_SIZE } },
      ]),
    ),
  });

  function bucketsFor(name: keyof typeof FACET_FIELDS): FacetBucket[] {
    const buckets = result.aggregations?.[name]?.buckets;
    if (!Array.isArray(buckets)) return [];
    return buckets.map((bucket) => {
      // Boolean fields (isRemote) bucket by 0/1 internally; ES also returns a human-readable
      // `key_as_string` ("true"/"false") for these, which the client's own types don't declare
      // on the base bucket shape but is present on the wire — prefer it when there.
      const keyAsString = (bucket as { key_as_string?: string }).key_as_string;
      return { value: keyAsString ?? String(bucket.key), count: bucket.doc_count };
    });
  }

  return {
    hits: result.hits.hits.map((hit) => hit._source!),
    facets: {
      specialization: bucketsFor("specialization"),
      seniority: bucketsFor("seniority"),
      isRemote: bucketsFor("isRemote"),
      location: bucketsFor("location"),
      company: bucketsFor("company"),
    },
  };
}
