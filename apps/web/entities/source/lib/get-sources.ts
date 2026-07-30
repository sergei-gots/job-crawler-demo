import { getJson } from "@/shared/lib/api";

export type SourceType = "STATIC" | "DYNAMIC";

export interface Source {
  id: number;
  name: string;
  baseUrl: string;
  type: SourceType;
  isActive: boolean;
  respectRobotsTxt: boolean;
  defaultDelayMs: number;
  maxPagesToCrawl: number;
}

export async function getSources(token: string): Promise<Source[]> {
  const res = await getJson<{ sources: Source[] }>("/sources", token);
  return res.sources;
}
