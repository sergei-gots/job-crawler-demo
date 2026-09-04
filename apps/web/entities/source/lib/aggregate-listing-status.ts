import type { CrawlRun, DisplayStatus } from "./crawl-run-types";
import type { Listing } from "./get-sources";

/**
 * Rolls up a source's listings into one status for its base-url row. Only active listings count
 * (crawl-all skips inactive ones, so their last run status shouldn't drag the parent's status
 * either) — precedence: any active listing RUNNING wins outright; else any active listing that
 * has never run makes the whole source read as PENDING (something's still outstanding, even if
 * another listing already completed); else any non-COMPLETED terminal status (FAILED/STOPPED)
 * wins; else COMPLETED only once every active listing is COMPLETED. Returns "INACTIVE" if there
 * are no active listings at all.
 */
export function aggregateListingStatus(
  listings: Listing[],
  listingRuns: Record<number, CrawlRun | null>,
): DisplayStatus {
  const active = listings.filter((listing) => listing.isActive);
  if (active.length === 0) return "INACTIVE";

  const runs = active.map((listing) => listingRuns[listing.id] ?? null);
  if (runs.some((r) => r?.status === "RUNNING")) return "RUNNING";
  if (runs.some((r) => r === null)) return "PENDING";
  if (runs.some((r) => r?.status === "FAILED")) return "FAILED";
  if (runs.some((r) => r?.status === "STOPPED")) return "STOPPED";
  return "COMPLETED";
}
