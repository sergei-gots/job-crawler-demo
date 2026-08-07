import { CRAWLER_RESULTS_INDEX, ensureCrawlerResultsIndex } from "./crawlerResultsIndex.js";
import { esClient } from "./esClient.js";
import { staleCutoffIso } from "./queryVacancies.js";

export interface VacancySuggestion {
  value: string;
  field: "title" | "company";
}

const SUGGEST_FIELDS = {
  title: "title.suggest",
  company: "company.suggest",
} as const;

const MIN_PREFIX_LENGTH = 2;
const BUCKET_SIZE = 5;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface SuggestBucket {
  key: string;
  doc_count: number;
  original?: { hits?: { hits?: { _source?: Record<string, unknown> }[] } };
}

/**
 * Suggests distinct `title`/`company` values matching a case-insensitive prefix, for the search
 * box's autocomplete dropdown (Increment 3c). Not per-vacancy result suggestions — see the design
 * doc's Phase 3c section for why (helps formulate a query, doesn't replace the results page).
 */
export async function suggestVacancies(prefix: string): Promise<VacancySuggestion[]> {
  const trimmed = prefix.trim();
  if (trimmed.length < MIN_PREFIX_LENGTH) return [];

  await ensureCrawlerResultsIndex();

  const include = `${escapeRegExp(trimmed.toLowerCase())}.*`;

  const result = await esClient.search({
    index: CRAWLER_RESULTS_INDEX,
    size: 0,
    query: { bool: { filter: [{ range: { lastSeenAt: { gte: staleCutoffIso() } } }] } },
    aggregations: Object.fromEntries(
      Object.entries(SUGGEST_FIELDS).map(([field, subField]) => [
        field,
        {
          terms: { field: subField, include, size: BUCKET_SIZE },
          aggregations: {
            original: { top_hits: { size: 1, _source: [field] } },
          },
        },
      ]),
    ),
  });

  const suggestions: VacancySuggestion[] = [];
  for (const field of Object.keys(SUGGEST_FIELDS) as (keyof typeof SUGGEST_FIELDS)[]) {
    const buckets = (result.aggregations?.[field] as { buckets?: SuggestBucket[] } | undefined)
      ?.buckets;
    if (!Array.isArray(buckets)) continue;
    for (const bucket of buckets) {
      const original = bucket.original?.hits?.hits?.[0]?._source?.[field];
      const value = typeof original === "string" ? original : bucket.key;
      suggestions.push({ value, field });
    }
  }

  const seen = new Set<string>();
  return suggestions.filter(({ field, value }) => {
    const dedupeKey = `${field}:${value}`;
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });
}
