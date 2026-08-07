import type { CrawlSource } from "@prisma/client";

export interface RawVacancy {
  externalId: string;
  title: string;
  company: string | null;
  url: string;
  postedAt: string | null;
  sourceId: number;
  /** Detail-page fields below are only present once a source's enrichDetails has run. */
  description?: string | null;
  location?: string | null;
  isRemote?: boolean | null;
  skillsSummary?: string | null;
  specialization?: string | null;
  seniority?: string | null;
}

export interface CrawlResult {
  vacancies: RawVacancy[];
  /** One line per fetched page, e.g. "fetched page 1 (cache: miss, 25 vacancies)". */
  pageLogs: string[];
}

export interface EnrichDetailsResult {
  enrichedCount: number;
}

export type LogProgress = (message: string, level?: "INFO" | "WARN" | "ERROR") => Promise<void>;

export interface CrawlStrategy {
  crawl(source: CrawlSource): Promise<CrawlResult>;
  /**
   * Optional: fetches each vacancy's own detail page for richer fields (description, location,
   * etc.). Sources without a detail-crawl implementation simply omit this method. `logProgress`
   * is called once per vacancy (not batched) so `JobLog` shows live progress during what can be
   * a multi-minute, rate-limited loop.
   */
  enrichDetails?(
    source: CrawlSource,
    vacancies: RawVacancy[],
    isCancelled: () => boolean,
    logProgress: LogProgress,
  ): Promise<EnrichDetailsResult>;
}
