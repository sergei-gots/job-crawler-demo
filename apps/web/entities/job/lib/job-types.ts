export type JobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface JobConfig {
  delayMs?: number;
  maxDepth?: number;
  usePuppeteer?: boolean;
}

export interface JobLog {
  id: number;
  jobId: number;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  createdAt: string;
}

export interface Job {
  id: number;
  userId: string;
  name: string;
  description: string | null;
  sources: number[];
  keywords: string | null;
  config: JobConfig;
  status: JobStatus;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobWithLogs extends Job {
  logs: JobLog[];
}
