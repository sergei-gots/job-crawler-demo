import type { CrawlSource } from "@prisma/client";
import { axiosCheerioStrategy } from "./strategies/axiosCheerioStrategy.js";
import type { CrawlStrategy } from "./types.js";

// Only habr_career has a real parser this increment; other seeded sources (RemoteOK,
// WeWorkRemotely, Craigslist) stay deferred per CLAUDE.md's "one source, done well" MVP scope,
// even though their CrawlSource rows already exist. getStrategy returns null for them so the
// runner can log a WARN and skip rather than crash.
const IMPLEMENTED_SOURCE_NAMES = new Set(["Habr Career"]);

export function getStrategy(source: CrawlSource): CrawlStrategy | null {
  if (!IMPLEMENTED_SOURCE_NAMES.has(source.name)) return null;
  return axiosCheerioStrategy;
}
