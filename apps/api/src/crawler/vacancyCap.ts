import type { RawVacancy } from "./types.js";

/**
 * Truncates a listing pass's vacancies to `source.maxVacanciesToCrawl`, shared by every
 * CrawlStrategy so the cap is enforced identically regardless of how a source paginates (or
 * doesn't). Strategies with real page-based pagination (habrCareerStrategy) call this once per
 * fetched page so they can stop requesting further pages once the cap is reached; strategies with
 * a single one-shot listing fetch (remoteOkStrategy, weWorkRemotelyStrategy) call it once after
 * parsing.
 */
export function applyVacancyCap(
  vacancies: RawVacancy[],
  max: number,
): { vacancies: RawVacancy[]; truncated: boolean } {
  if (vacancies.length <= max) return { vacancies, truncated: false };
  return { vacancies: vacancies.slice(0, max), truncated: true };
}
