import { getJson } from "@/shared/lib/api";
import type { JobWithLogs } from "./job-types";

export async function getJob(id: number, token: string): Promise<JobWithLogs> {
  const res = await getJson<{ job: JobWithLogs }>(`/jobs/${id}`, token);
  return res.job;
}
