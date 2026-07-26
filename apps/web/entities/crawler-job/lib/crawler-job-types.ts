export type CrawlerJobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "STOPPED";

export interface CrawlerJobLog {
  id: number;
  jobId: number;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  createdAt: string;
}

export interface CrawlerJob {
  id: number;
  userId: string;
  name: string;
  description: string | null;
  sources: number[];
  keywords: string | null;
  status: CrawlerJobStatus;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrawlerJobWithLogs extends CrawlerJob {
  logs: CrawlerJobLog[];
}

export interface Vacancy {
  sourceId: number;
  externalId: string;
  title: string;
  company: string | null;
  url: string;
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}
