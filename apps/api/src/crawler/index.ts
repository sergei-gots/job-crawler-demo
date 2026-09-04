import type { CrawlSource } from "@prisma/client";
import { habrCareerStrategy } from "./strategies/habrCareerStrategy.js";
import { remoteOkStrategy } from "./strategies/remoteOkStrategy.js";
import { weWorkRemotelyStrategy } from "./strategies/weWorkRemotelyStrategy.js";
import type { CrawlStrategy } from "./types.js";

// habr_career, RemoteOK, and WeWorkRemotely have real parsers; Craigslist stays deferred per
// CLAUDE.md's scope, even though its CrawlSource row already exists. getStrategy returns null for
// it so the runner can log a WARN and skip rather than crash.
//
// Keyed by source.name — a strategy is 1:1 with a specific source, not a category of sources,
// since even two Puppeteer-based sources (remoteok, weworkremotely) need completely different
// selectors/navigation.
const STRATEGIES_BY_SOURCE_NAME: Record<string, CrawlStrategy> = {
  "Habr Career": habrCareerStrategy,
  RemoteOK: remoteOkStrategy,
  WeWorkRemotely: weWorkRemotelyStrategy,
};

export function getStrategy(source: CrawlSource): CrawlStrategy | null {
  return STRATEGIES_BY_SOURCE_NAME[source.name] ?? null;
}
