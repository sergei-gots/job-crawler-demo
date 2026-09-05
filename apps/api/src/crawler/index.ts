import type { CrawlSource } from "@prisma/client";
import { craigslistStrategy } from "./strategies/craigslistStrategy.js";
import { habrCareerStrategy } from "./strategies/habrCareerStrategy.js";
import { remoteOkStrategy } from "./strategies/remoteOkStrategy.js";
import { weWorkRemotelyStrategy } from "./strategies/weWorkRemotelyStrategy.js";
import type { CrawlStrategy } from "./types.js";

// All four seeded sources have real parsers (see .claude/features/10_FEATURE_CRAIGSLIST.md for
// Craigslist, the last one to land). getStrategy returns null only for a source name with no
// registered strategy at all, so the runner can log a WARN and skip rather than crash.
//
// Keyed by source.name — a strategy is 1:1 with a specific source, not a category of sources,
// since even two Puppeteer-based sources (remoteok, weworkremotely) need completely different
// selectors/navigation.
const STRATEGIES_BY_SOURCE_NAME: Record<string, CrawlStrategy> = {
  "Habr Career": habrCareerStrategy,
  RemoteOK: remoteOkStrategy,
  WeWorkRemotely: weWorkRemotelyStrategy,
  Craigslist: craigslistStrategy,
};

export function getStrategy(source: CrawlSource): CrawlStrategy | null {
  return STRATEGIES_BY_SOURCE_NAME[source.name] ?? null;
}
