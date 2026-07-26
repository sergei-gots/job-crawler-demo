import type { CrawlSource } from "@prisma/client";

export interface RawVacancy {
  externalId: string;
  title: string;
  company: string | null;
  url: string;
  postedAt: string | null;
  sourceId: number;
}

export interface CrawlResult {
  vacancies: RawVacancy[];
  /** One line per fetched page, e.g. "fetched page 1 (cache: miss, 25 vacancies)". */
  pageLogs: string[];
}

export interface CrawlStrategy {
  crawl(source: CrawlSource): Promise<CrawlResult>;
}
