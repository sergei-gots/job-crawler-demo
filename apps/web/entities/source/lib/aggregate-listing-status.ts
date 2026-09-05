import type { CrawlRun, DisplayStatus } from "./crawl-run-types";
import type { Listing } from "./get-sources";

/**
 * Whether an inactive listing's real run status still "counts" for display purposes - RUNNING
 * (a crawl that's still genuinely happening must never be hidden) and COMPLETED (a real
 * accomplishment shouldn't be erased) survive deactivation; STOPPED/FAILED/never-run don't, and
 * read as plain "INACTIVE" instead. Shared by `listingDisplayStatus` (one listing's own badge) and
 * `aggregateListingStatus` (which listings count toward the parent source's rollup) so the two
 * can't drift apart on this rule.
 */
function survivesDeactivation(status: CrawlRun["status"] | undefined): boolean {
  return status === "RUNNING" || status === "COMPLETED";
}

/**
 * One listing's own displayed badge status. Mirrors `aggregateListingStatus`'s "what survives
 * deactivation" rule: a real run status wins over `isActive` only when it's RUNNING or COMPLETED;
 * any other status (or no run at all) reads as "INACTIVE" once the listing is deactivated.
 */
export function listingDisplayStatus(listing: Listing, listingRun: CrawlRun | null | undefined): DisplayStatus {
  if (listing.isActive) return listingRun?.status ?? "PENDING";
  return survivesDeactivation(listingRun?.status) ? listingRun!.status : "INACTIVE";
}

/**
 * Rolls up a source's listings into one status for its base-url row. A listing counts if it's
 * active, or if it's inactive but its last known run is RUNNING or COMPLETED - deactivating a
 * listing must never hide a crawl that's still genuinely running (see `sources-page.tsx`'s
 * Stop-button gating for the same rule), and shouldn't erase what it actually accomplished down
 * to a blank "INACTIVE" either (a listing deactivated right after finishing a real crawl still
 * reads as COMPLETED). A STOPPED or FAILED run does NOT keep a deactivated listing counted,
 * though - unlike RUNNING (still happening) or COMPLETED (a real accomplishment), an interrupted/
 * failed run isn't something deactivating the listing should keep displaying; it reads as
 * INACTIVE instead, same as a listing that never ran at all. Precedence among the counted
 * listings: any RUNNING wins outright; else any that has never run at all makes the whole source
 * read as PENDING (something's still outstanding, even if another listing already completed);
 * else any non-COMPLETED terminal status (FAILED/STOPPED) wins; else COMPLETED once every counted
 * listing is COMPLETED. Returns "INACTIVE" only when no listing counts at all.
 */
export function aggregateListingStatus(
  listings: Listing[],
  listingRuns: Record<number, CrawlRun | null>,
): DisplayStatus {
  const counted = listings.filter(
    (listing) => listing.isActive || survivesDeactivation(listingRuns[listing.id]?.status),
  );
  if (counted.length === 0) return "INACTIVE";

  const runs = counted.map((listing) => listingRuns[listing.id] ?? null);
  if (runs.some((r) => r?.status === "RUNNING")) return "RUNNING";
  if (runs.some((r) => r === null)) return "PENDING";
  if (runs.some((r) => r?.status === "FAILED")) return "FAILED";
  if (runs.some((r) => r?.status === "STOPPED")) return "STOPPED";
  return "COMPLETED";
}
