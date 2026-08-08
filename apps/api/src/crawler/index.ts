import type { CrawlSource } from "@prisma/client";
import { habrCareerStrategy } from "./strategies/habrCareerStrategy.js";
import { remoteOkStrategy } from "./strategies/remoteOkStrategy.js";
import type { CrawlStrategy } from "./types.js";

// habr_career and RemoteOK have real parsers (Increment 4); WeWorkRemotely and Craigslist stay
// deferred per CLAUDE.md's scope, even though their CrawlSource rows already exist. getStrategy
// returns null for them so the runner can log a WARN and skip rather than crash.
//
// Keyed by source.name, not source.type (STATIC/DYNAMIC) — type only says "needs a browser or
// not," it doesn't imply every source of that type can share one strategy's selectors/navigation.
const STRATEGIES_BY_SOURCE_NAME: Record<string, CrawlStrategy> = {
  "Habr Career": habrCareerStrategy,
  RemoteOK: remoteOkStrategy,
};

export function getStrategy(source: CrawlSource): CrawlStrategy | null {
  return STRATEGIES_BY_SOURCE_NAME[source.name] ?? null;
}
