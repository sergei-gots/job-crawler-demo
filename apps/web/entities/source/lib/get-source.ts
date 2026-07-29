import { getJson } from "@/shared/lib/api";
import type { Source } from "./get-sources";

export async function getSource(id: number, token: string): Promise<Source> {
  const res = await getJson<{ source: Source }>(`/sources/${id}`, token);
  return res.source;
}
