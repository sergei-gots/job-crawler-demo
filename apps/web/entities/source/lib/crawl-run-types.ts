export type CrawlStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "STOPPED";

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
