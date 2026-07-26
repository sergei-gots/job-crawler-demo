import { postJson } from "@/shared/lib/api";
import type { CrawlerJob } from "@/entities/crawler-job";
import type { CreateJobFormValues } from "../model/create-job-schema";

export async function createJob(values: CreateJobFormValues, token: string): Promise<CrawlerJob> {
  const { name, description, sources, keywords } = values;
  const res = await postJson<{ job: CrawlerJob }>(
    "/crawler-jobs",
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
