export type CrawlStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "STOPPED";

// Display-only, never a real CrawlRun.status value from the backend — shown instead of a run
// status for a listing (or a source's aggregate) when isActive is false, since an inactive
// listing is excluded from crawling entirely and its last run status would be misleading.
export type DisplayStatus = CrawlStatus | "INACTIVE";

export interface CrawlLog {
  id: number;
  runId: number;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  createdAt: string;
}

export interface CrawlRun {
  id: number;
  sourceId: number;
  // Set for a listing-scoped run (see .claude/features/09_FEATURE_CRAWL_LISTINGS.md), null for a
  // source-level one.
  listingId: number | null;
  status: CrawlStatus;
  vacanciesFound: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrawlRunWithLogs extends CrawlRun {
  logs: CrawlLog[];
}
