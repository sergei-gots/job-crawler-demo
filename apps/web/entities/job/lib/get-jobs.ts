import { getJson } from "@/shared/lib/api";
import type { Job } from "./job-types";

export async function getJobs(token: string): Promise<Job[]> {
  const res = await getJson<{ jobs: Job[] }>("/jobs", token);
  return res.jobs;
}
