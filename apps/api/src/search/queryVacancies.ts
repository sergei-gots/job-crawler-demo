import type { QueryDslQueryContainer, AggregationsStringTermsAggregate } from "@elastic/elasticsearch/lib/api/types.js";
import { CRAWLER_RESULTS_INDEX, ensureCrawlerResultsIndex, type CrawlerResultDoc } from "./crawlerResultsIndex.js";
import { esClient } from "./esClient.js";

function maxVacancyAgeDays(): number {
  return Number(process.env.MAX_VACANCY_AGE_DAYS ?? 14);
}

/** Age cutoff shared with `suggestVacancies` — both only consider vacancies still within the
 * staleness window. */
export function staleCutoffIso(): string {
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

/**
 * Best-effort, listing-scoped view (see `CrawlerResultDoc.listingId`'s v4 schema note): only
 * returns vacancies whose most recent upsert was attributed to this listing. A vacancy that also
 * appears in the source's other listings, but was last (re-)crawled by one of those instead,
 * won't show here even though it's still part of this listing's live category — this is the
 * accepted tradeoff of not storing a per-listing membership set, only a single "last touched by"
 * pointer alongside the source-wide dedup key.
 */
export async function queryVacanciesForListing(
  sourceId: number,
  listingId: number,
): Promise<CrawlerResultDoc[]> {
  await ensureCrawlerResultsIndex();

  const result = await esClient.search<CrawlerResultDoc>({
    index: CRAWLER_RESULTS_INDEX,
    query: {
      bool: {
        filter: [
          { term: { sourceId } },
          { term: { listingId } },
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
  page?: number;
  pageSize?: number;
}

export interface FacetBucket {
  value: string;
  count: number;
}

export interface VacancySearchResult {
  hits: CrawlerResultDoc[];
  /** Total number of matching vacancies across all pages (not just the returned page). */
  total: number;
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

const DEFAULT_PAGE_SIZE = 10;
// Caps `from + size` well under Elasticsearch's default `index.max_result_window` (10 000), so
// offset pagination stays valid even at the deepest reachable page for this project's corpus.
const MAX_PAGE_SIZE = 50;

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

  const pageSize = Math.min(Math.max(1, Math.trunc(filters.pageSize ?? DEFAULT_PAGE_SIZE)), MAX_PAGE_SIZE);
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const from = (page - 1) * pageSize;

  const result = await esClient.search<CrawlerResultDoc, Record<keyof typeof FACET_FIELDS, AggregationsStringTermsAggregate>>({
    index: CRAWLER_RESULTS_INDEX,
    query: { bool: { filter, must } },
    from,
    size: pageSize,
    // Facets aggregate over the whole match set, so report the exact total too — otherwise it
    // caps at 10 000 and the "Page X of N" control would understate deep result sets.
    track_total_hits: true,
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

  const totalHits = result.hits.total;
  const total = typeof totalHits === "number" ? totalHits : (totalHits?.value ?? 0);

  return {
    hits: result.hits.hits.map((hit) => hit._source!),
    total,
    facets: {
      specialization: bucketsFor("specialization"),
      seniority: bucketsFor("seniority"),
      isRemote: bucketsFor("isRemote"),
      location: bucketsFor("location"),
      company: bucketsFor("company"),
    },
  };
}
