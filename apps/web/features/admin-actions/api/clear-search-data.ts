import { postJson } from "@/shared/lib/api";

export async function clearSearchData(token: string): Promise<void> {
  await postJson<void>("/admin/clear-search-data", {}, token);
}
