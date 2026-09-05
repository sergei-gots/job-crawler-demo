import { postJson } from "@/shared/lib/api";

export async function clearListingCache(
  sourceId: number,
  listingId: number,
  token: string,
): Promise<void> {
  await postJson<void>(`/sources/${sourceId}/listings/${listingId}/clear-cache`, {}, token);
}
