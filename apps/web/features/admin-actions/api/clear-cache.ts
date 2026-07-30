import { postJson } from "@/shared/lib/api";

export async function clearCache(token: string): Promise<void> {
  await postJson<void>("/admin/clear-cache", {}, token);
}
