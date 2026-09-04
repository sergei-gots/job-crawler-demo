import { patchJson } from "@/shared/lib/api";
import type { Source } from "@/entities/source";

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
