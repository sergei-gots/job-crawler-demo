import { patchJson } from "@/shared/lib/api";
import type { Listing, Source } from "@/entities/source";

export async function updateSourceMaxVacanciesToCrawl(
  sourceId: number,
  maxVacanciesToCrawl: number,
  token: string,
): Promise<Source> {
  const res = await patchJson<{ source: Source }>(
    `/sources/${sourceId}`,
    { maxVacanciesToCrawl },
    token,
  );
  return res.source;
}

export async function updateSourceDelayMs(
  sourceId: number,
  defaultDelayMs: number,
  token: string,
): Promise<Source> {
  const res = await patchJson<{ source: Source }>(
    `/sources/${sourceId}`,
    { defaultDelayMs },
    token,
  );
  return res.source;
}

/** Immediate-apply (no Save button) — a checkbox toggle is a single deliberate action. */
export async function updateListingActive(
  sourceId: number,
  listingId: number,
  isActive: boolean,
  token: string,
): Promise<Listing> {
  const res = await patchJson<{ listing: Listing }>(
    `/sources/${sourceId}/listings/${listingId}`,
    { isActive },
    token,
  );
  return res.listing;
}
