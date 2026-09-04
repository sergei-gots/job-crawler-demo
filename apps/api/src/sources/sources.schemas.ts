import { z } from "zod";

const MIN_VACANCIES_TO_CRAWL = 1;
const MAX_VACANCIES_TO_CRAWL = 200;

export const MIN_DELAY_MS = 1000;
export const MAX_DELAY_MS = 20000;

export const updateSourceSettingsSchema = z
  .object({
    maxVacanciesToCrawl: z
      .number()
      .int("Vacancies to crawl must be a whole number")
      .gte(MIN_VACANCIES_TO_CRAWL, `Vacancies to crawl must be at least ${MIN_VACANCIES_TO_CRAWL}`)
      .lte(MAX_VACANCIES_TO_CRAWL, `Vacancies to crawl must be at most ${MAX_VACANCIES_TO_CRAWL}`)
      .optional(),
    defaultDelayMs: z
      .number()
      .int("Rate limit delay must be a whole number")
      .gte(MIN_DELAY_MS, `Rate limit delay must be at least ${MIN_DELAY_MS}`)
      .lte(MAX_DELAY_MS, `Rate limit delay must be at most ${MAX_DELAY_MS}`)
      .optional(),
  })
  .refine((data) => data.maxVacanciesToCrawl !== undefined || data.defaultDelayMs !== undefined, {
    message: "At least one field must be provided",
  });

export type UpdateSourceSettingsInput = z.infer<typeof updateSourceSettingsSchema>;
