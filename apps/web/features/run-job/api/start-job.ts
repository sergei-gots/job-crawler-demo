import { postJson } from "@/shared/lib/api";
import type { Job } from "@/entities/job";

export async function startJob(id: number, token: string): Promise<Job> {
  const res = await postJson<{ job: Job }>(`/jobs/${id}/start`, {}, token);
  return res.job;
}
