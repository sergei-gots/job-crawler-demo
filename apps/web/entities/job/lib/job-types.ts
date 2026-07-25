export type JobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "STOPPED";

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
  status: JobStatus;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobWithLogs extends Job {
  logs: JobLog[];
}
