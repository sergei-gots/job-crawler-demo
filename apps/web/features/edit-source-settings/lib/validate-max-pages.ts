export const MIN_PAGES_TO_CRAWL = 1;
export const MAX_PAGES_TO_CRAWL = 4;

/** Mirrors the range enforced server-side in `sources.schemas.ts`. */
export function validateMaxPagesToCrawl(value: number): string | null {
  if (!Number.isInteger(value)) {
    return "Must be a whole number";
  }
  if (value < MIN_PAGES_TO_CRAWL || value > MAX_PAGES_TO_CRAWL) {
    return `Must be between ${MIN_PAGES_TO_CRAWL} and ${MAX_PAGES_TO_CRAWL}`;
  }
  return null;
}
