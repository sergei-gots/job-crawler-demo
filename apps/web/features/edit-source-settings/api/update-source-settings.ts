import { patchJson } from "@/shared/lib/api";
import type { Source } from "@/entities/source";

export async function updateSourceMaxPagesToCrawl(
  sourceId: number,
  maxPagesToCrawl: number,
  token: string,
): Promise<Source> {
  const res = await patchJson<{ source: Source }>(
    `/sources/${sourceId}`,
    { maxPagesToCrawl },
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
