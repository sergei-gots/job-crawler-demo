import { getJson } from "@/shared/lib/api";

export interface Source {
  id: number;
  name: string;
  baseUrl: string;
  isActive: boolean;
  defaultDelayMs: number;
  maxVacanciesToCrawl: number;
  // How this source is actually crawled, computed server-side from its CrawlStrategy (see
  // CrawlStrategy.description in apps/api) rather than a stored classification — null for a
  // source with no implemented strategy yet.
  strategyDescription: string | null;
}

export async function getSources(token: string): Promise<Source[]> {
  const res = await getJson<{ sources: Source[] }>("/sources", token);
  return res.sources;
}
