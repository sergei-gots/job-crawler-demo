import { getJson } from "@/shared/lib/api";

export type StrategyStepType = "process" | "decision" | "problem" | "solution" | "terminal";

export interface StrategyStep {
  type: StrategyStepType;
  title: string;
  detail?: {
    method?: string;
    explanation: string;
    result?: string;
  };
}

// A named, independently-crawlable sub-target of a source (see .claude/features/
// 09_FEATURE_CRAWL_LISTINGS.md) — additive only, most sources have none (empty Source.listings).
export interface Listing {
  id: number;
  label: string;
  subPath: string;
  isActive: boolean;
}

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
  // The step-by-step chain traced through that CrawlStrategy's crawl()/enrichDetails() — see
  // CrawlStrategy.steps in apps/api. A generic 2-step fallback for a source with no implemented
  // strategy yet (never empty).
  strategySteps: StrategyStep[];
  // Empty for sources that crawl as one unit (Habr Career, RemoteOK, Craigslist). Non-empty
  // means this source crawls at the listing level instead — see source-detail-page.tsx.
  listings: Listing[];
}

export async function getSources(token: string): Promise<Source[]> {
  const res = await getJson<{ sources: Source[] }>("/sources", token);
  return res.sources;
}
