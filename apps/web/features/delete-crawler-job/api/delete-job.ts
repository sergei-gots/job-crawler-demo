import { deleteRequest } from "@/shared/lib/api";

export async function deleteJob(id: number, token: string): Promise<void> {
  await deleteRequest(`/crawler-jobs/${id}`, token);
}
