export const MIN_DELAY_MS = 1000;
export const MAX_DELAY_MS = 20000;

/** Mirrors the range enforced server-side in `sources.schemas.ts`. */
export function validateDelayMs(value: number): string | null {
  if (!Number.isInteger(value)) {
    return "Must be a whole number";
  }
  if (value < MIN_DELAY_MS || value > MAX_DELAY_MS) {
    return `Must be between ${MIN_DELAY_MS} and ${MAX_DELAY_MS}`;
  }
  return null;
}
