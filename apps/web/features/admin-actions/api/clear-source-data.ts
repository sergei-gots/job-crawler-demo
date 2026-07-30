import { postJson } from "@/shared/lib/api";

export async function clearSourceData(sourceId: number, token: string): Promise<void> {
  await postJson<void>(`/sources/${sourceId}/clear-data`, {}, token);
}
