export const MIN_VACANCIES_TO_CRAWL = 1;
export const MAX_VACANCIES_TO_CRAWL = 200;

/** Mirrors the range enforced server-side in `sources.schemas.ts`. */
export function validateMaxVacanciesToCrawl(value: number): string | null {
  if (!Number.isInteger(value)) {
    return "Must be a whole number";
  }
  if (value < MIN_VACANCIES_TO_CRAWL || value > MAX_VACANCIES_TO_CRAWL) {
    return `Must be between ${MIN_VACANCIES_TO_CRAWL} and ${MAX_VACANCIES_TO_CRAWL}`;
  }
  return null;
}
