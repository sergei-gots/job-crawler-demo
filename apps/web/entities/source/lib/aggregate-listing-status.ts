import type { CrawlRun, DisplayStatus } from "./crawl-run-types";
import type { Listing } from "./get-sources";

/**
 * Rolls up a source's listings into one status for its base-url row. A listing counts if it's
 * either active, or inactive but already has real run history — deactivating a listing shouldn't
 * erase what it actually accomplished down to a blank "INACTIVE" (e.g. a listing deactivated
 * right after finishing a real crawl should still read as COMPLETED, not have its completion
 * hidden), but a listing that's inactive and has never run at all has nothing to contribute and
 * is excluded, same as before. Precedence among the counted listings: any RUNNING wins outright;
 * else any that has never run at all makes the whole source read as PENDING (something's still
 * outstanding, even if another listing already completed); else any non-COMPLETED terminal status
 * (FAILED/STOPPED) wins; else COMPLETED once every counted listing is COMPLETED. Returns
 * "INACTIVE" only when no listing counts at all (every listing is both inactive and unrun).
 */
export function aggregateListingStatus(
  listings: Listing[],
  listingRuns: Record<number, CrawlRun | null>,
): DisplayStatus {
  const counted = listings.filter((listing) => listing.isActive || listingRuns[listing.id] != null);
  if (counted.length === 0) return "INACTIVE";

  const runs = counted.map((listing) => listingRuns[listing.id] ?? null);
  if (runs.some((r) => r?.status === "RUNNING")) return "RUNNING";
  if (runs.some((r) => r === null)) return "PENDING";
  if (runs.some((r) => r?.status === "FAILED")) return "FAILED";
  if (runs.some((r) => r?.status === "STOPPED")) return "STOPPED";
  return "COMPLETED";
}
