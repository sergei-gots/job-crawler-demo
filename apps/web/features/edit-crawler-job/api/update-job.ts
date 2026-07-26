import { patchJson } from "@/shared/lib/api";
import type { CrawlerJob } from "@/entities/crawler-job";
import type { EditJobFormValues } from "../model/edit-job-schema";

export async function updateJob(
  id: number,
  values: EditJobFormValues,
  token: string,
): Promise<CrawlerJob> {
  const { name, description, sources, keywords } = values;
  const res = await patchJson<{ job: CrawlerJob }>(
    `/crawler-jobs/${id}`,
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
