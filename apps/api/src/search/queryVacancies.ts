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

/** Matched-term fragments for one hit, only populated for fields that actually matched `filters.q`
 * - a field the query didn't match (or no `q` at all) is simply absent, not an empty string.
 * Fragment text uses HIGHLIGHT_PRE_TAG/HIGHLIGHT_POST_TAG (see below) to mark matched substrings;
 * the frontend splits on these markers to render `<mark>` rather than trusting raw HTML. */
export interface VacancyHighlight {
  title?: string;
  company?: string;
  description?: string;
}

export interface VacancySearchResult {
  hits: (CrawlerResultDoc & { highlight?: VacancyHighlight })[];
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

// specialization/seniority/isRemote are low-cardinality enums - 20 comfortably covers every
// distinct value seen. company/location are free text sourced from four different crawlers and
// can have a much longer tail (distinct employer names, city/region strings), so they get a
// higher cap to keep more of that tail selectable as a facet - still a cap, not "all values", but
// a reasonable increase over the shared default.
const DEFAULT_FACET_AGG_SIZE = 20;
const LONG_TAIL_FACET_AGG_SIZE = 100;
const FACET_AGG_SIZE: Record<keyof typeof FACET_FIELDS, number> = {
  specialization: DEFAULT_FACET_AGG_SIZE,
  seniority: DEFAULT_FACET_AGG_SIZE,
  isRemote: DEFAULT_FACET_AGG_SIZE,
  location: LONG_TAIL_FACET_AGG_SIZE,
  company: LONG_TAIL_FACET_AGG_SIZE,
};

// Distinctive, unlikely-to-collide markers (not real HTML tags) so the frontend can split matched
// text out of a highlight fragment and render it as its own React node - avoids ever trusting raw
// HTML from an ES response via dangerouslySetInnerHTML. Kept in sync manually with the matching
// constants in apps/web/entities/vacancy/lib/highlight.ts (no shared-types package in this repo).
export const HIGHLIGHT_PRE_TAG = "@@HL_START@@";
export const HIGHLIGHT_POST_TAG = "@@HL_END@@";

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
  // A `terms` filter on a boolean field excludes documents missing it entirely (e.g. every
  // Craigslist vacancy, which never sets isRemote at all - see craigslistStrategy.ts). Selecting
  // both "Remote" and "On-site" is meant to read as "no filter" per the two-checkbox design
  // (03_FEATURE_CRAWL_SEARCH_SEPARATION.md), so only apply the filter when exactly one value is
  // selected - selecting both, or neither, means "everything," including isRemote-unset docs.
  if (filters.isRemote?.length === 1) filter.push({ terms: { isRemote: filters.isRemote } });
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
        { terms: { field, size: FACET_AGG_SIZE[name as keyof typeof FACET_FIELDS] } },
      ]),
    ),
    // Only meaningful (and only requested) when there's a free-text query to highlight matches
    // for - the same fields searched by the multi_match above. `number_of_fragments: 0` returns
    // the whole field with matches marked, rather than an extracted snippet - the frontend already
    // truncates the description with its own "Show more" toggle, so it needs the complete
    // marked-up text to truncate/expand correctly, not a fixed-size fragment picked by ES.
    ...(filters.q
      ? {
          highlight: {
            pre_tags: [HIGHLIGHT_PRE_TAG],
            post_tags: [HIGHLIGHT_POST_TAG],
            fields: {
              title: { number_of_fragments: 0 },
              company: { number_of_fragments: 0 },
              description: { number_of_fragments: 0 },
            },
          },
        }
      : {}),
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

  function highlightFor(hit: { highlight?: Record<string, string[]> }): VacancyHighlight | undefined {
    const { highlight } = hit;
    if (!highlight) return undefined;
    const mapped: VacancyHighlight = {
      ...(highlight.title?.[0] ? { title: highlight.title[0] } : {}),
      ...(highlight.company?.[0] ? { company: highlight.company[0] } : {}),
      ...(highlight.description?.[0] ? { description: highlight.description[0] } : {}),
    };
    return Object.keys(mapped).length > 0 ? mapped : undefined;
  }

  return {
    hits: result.hits.hits.map((hit) => ({ ...hit._source!, highlight: highlightFor(hit) })),
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
