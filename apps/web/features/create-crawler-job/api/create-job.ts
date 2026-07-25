import { postJson } from "@/shared/lib/api";
import type { Job } from "@/entities/job";
import type { CreateJobFormValues } from "../model/create-job-schema";

export async function createJob(values: CreateJobFormValues, token: string): Promise<Job> {
  const { name, description, sources, keywords } = values;
  const res = await postJson<{ job: Job }>(
    "/jobs",
    {
      name,
      description: description || undefined,
      sources,
      keywords: keywords || undefined,
    },
    token,
  );
  return res.job;
}
