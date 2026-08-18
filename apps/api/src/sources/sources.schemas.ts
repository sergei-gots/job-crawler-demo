import { z } from "zod";

const MIN_PAGES_TO_CRAWL = 1;
const MAX_PAGES_TO_CRAWL = 4;

export const updateSourceSettingsSchema = z.object({
  maxPagesToCrawl: z
    .number()
    .int("Pages to crawl must be a whole number")
    .gte(MIN_PAGES_TO_CRAWL, `Pages to crawl must be at least ${MIN_PAGES_TO_CRAWL}`)
    .lte(MAX_PAGES_TO_CRAWL, `Pages to crawl must be at most ${MAX_PAGES_TO_CRAWL}`),
});

export type UpdateSourceSettingsInput = z.infer<typeof updateSourceSettingsSchema>;
