"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { clearCache, clearSearchData } from "@/features/admin-actions";
import {
  crawlAll,
  sourceSlot,
  startListingCrawl,
  stopListingCrawl,
  useCrawlActions,
} from "@/features/run-crawl";
import { updateListingActive } from "@/features/edit-source-settings";
import { useRequireAuth } from "@/entities/session";
import {
  aggregateListingStatus,
  getListingRun,
  getSourceRun,
  getSources,
  listingDisplayStatus,
  StrategyFlow,
  type CrawlRun,
  type Listing,
  type Source,
} from "@/entities/source";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Label } from "@/shared/ui/label";
import { PageTitle } from "@/shared/ui/page-title";
import { StatusBadge } from "@/shared/ui/status-badge";

const POLL_INTERVAL_MS = 2000;

export function SourcesPage() {
  const { token, handleUnauthorized } = useRequireAuth();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [runs, setRuns] = useState<Record<number, CrawlRun | null>>({});
  const [listingRuns, setListingRuns] = useState<Record<number, CrawlRun | null>>({});
  const [expandedSourceIds, setExpandedSourceIds] = useState<Set<number>>(new Set());
  const [bulkPendingSourceIds, setBulkPendingSourceIds] = useState<Set<number>>(new Set());
  const [listingPendingIds, setListingPendingIds] = useState<Set<number>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [crawlAllPending, setCrawlAllPending] = useState(false);
  const [clearSearchDataPending, setClearSearchDataPending] = useState(false);
  const [clearCachePending, setClearCachePending] = useState(false);
  const [showStrategies, setShowStrategies] = useState(false);
  const [comparedSourceNames, setComparedSourceNames] = useState<Set<string>>(new Set());

  const loadRuns = useCallback(
    async (sourceIds: number[]) => {
      if (!token) return;
      const entries = await Promise.all(
        sourceIds.map(async (id) => [id, await getSourceRun(id, token)] as const),
      );
      setRuns(Object.fromEntries(entries));
    },
    [token],
  );

  const loadListingRuns = useCallback(
    async (listings: { sourceId: number; listingId: number }[]) => {
      if (!token || listings.length === 0) return;
      const entries = await Promise.all(
        listings.map(
          async ({ sourceId, listingId }) =>
            [listingId, await getListingRun(sourceId, listingId, token)] as const,
        ),
      );
      setListingRuns((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    },
    [token],
  );

  const loadSources = useCallback(async () => {
    if (!token) return;
    try {
      const result = await getSources(token);
      setSources(result);
      await Promise.all([
        loadRuns(result.map((source) => source.id)),
        loadListingRuns(
          result.flatMap((source) =>
            source.listings.map((listing) => ({ sourceId: source.id, listingId: listing.id })),
          ),
        ),
      ]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to load sources");
    }
  }, [token, handleUnauthorized, loadRuns, loadListingRuns]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount, matches entities/session/lib/use-require-auth.ts
    loadSources();
  }, [loadSources]);

  const hasRunningSource =
    Object.values(runs).some((run) => run?.status === "RUNNING") ||
    Object.values(listingRuns).some((run) => run?.status === "RUNNING");

  useEffect(() => {
    if (!hasRunningSource || !sources) return;
    const sourceIds = sources.map((source) => source.id);
    const allListings = sources.flatMap((source) =>
      source.listings.map((listing) => ({ sourceId: source.id, listingId: listing.id })),
    );
    const interval = setInterval(() => {
      loadRuns(sourceIds);
      loadListingRuns(allListings);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasRunningSource, sources, loadRuns, loadListingRuns]);

  const patchRun = useCallback((run: CrawlRun) => {
    if (run.listingId !== null) {
      setListingRuns((prev) => ({ ...prev, [run.listingId as number]: run }));
    } else {
      setRuns((prev) => ({ ...prev, [run.sourceId]: run }));
    }
  }, []);

  const { start, stop, isPending, error: actionError } = useCrawlActions({
    token,
    handleUnauthorized,
    onStarted: patchRun,
    onStopped: patchRun,
  });

  function toggleExpanded(sourceId: number) {
    setExpandedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }

  async function handleStartAllListings(source: Source) {
    if (!token) return;
    setBulkPendingSourceIds((prev) => new Set(prev).add(source.id));
    try {
      const toStart = source.listings.filter(
        (listing) => listing.isActive && listingRuns[listing.id]?.status !== "RUNNING",
      );
      const startedRuns = await Promise.all(
        toStart.map((listing) => startListingCrawl(source.id, listing.id, token)),
      );
      setListingRuns((prev) => {
        const next = { ...prev };
        for (const run of startedRuns) next[run.listingId as number] = run;
        return next;
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to start listing crawls");
    } finally {
      setBulkPendingSourceIds((prev) => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
    }
  }

  async function handleStopAllListings(source: Source) {
    if (!token) return;
    setBulkPendingSourceIds((prev) => new Set(prev).add(source.id));
    try {
      const toStop = source.listings.filter(
        (listing) => listingRuns[listing.id]?.status === "RUNNING",
      );
      const stoppedRuns = await Promise.all(
        toStop.map((listing) => stopListingCrawl(source.id, listing.id, token)),
      );
      setListingRuns((prev) => {
        const next = { ...prev };
        for (const run of stoppedRuns) next[run.listingId as number] = run;
        return next;
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to stop listing crawls");
    } finally {
      setBulkPendingSourceIds((prev) => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
    }
  }

  async function handleStartListing(sourceId: number, listingId: number) {
    if (!token) return;
    setListingPendingIds((prev) => new Set(prev).add(listingId));
    try {
      const run = await startListingCrawl(sourceId, listingId, token);
      setListingRuns((prev) => ({ ...prev, [listingId]: run }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to start listing crawl");
    } finally {
      setListingPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(listingId);
        return next;
      });
    }
  }

  async function handleStopListing(sourceId: number, listingId: number) {
    if (!token) return;
    setListingPendingIds((prev) => new Set(prev).add(listingId));
    try {
      const run = await stopListingCrawl(sourceId, listingId, token);
      setListingRuns((prev) => ({ ...prev, [listingId]: run }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to stop listing crawl");
    } finally {
      setListingPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(listingId);
        return next;
      });
    }
  }

  async function handleListingActiveChange(sourceId: number, listing: Listing, isActive: boolean) {
    if (!token) return;
    try {
      const updated = await updateListingActive(sourceId, listing.id, isActive, token);
      setSources((prev) =>
        prev?.map((source) =>
          source.id === sourceId
            ? { ...source, listings: source.listings.map((l) => (l.id === listing.id ? updated : l)) }
            : source,
        ) ?? null,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to update listing");
    }
  }

  async function handleCrawlAll() {
    if (!token) return;
    setCrawlAllPending(true);
    try {
      const startedRuns = await crawlAll(token);
      setRuns((prev) => {
        const next = { ...prev };
        for (const run of startedRuns) {
          if (run.listingId === null) next[run.sourceId] = run;
        }
        return next;
      });
      setListingRuns((prev) => {
        const next = { ...prev };
        for (const run of startedRuns) {
          if (run.listingId !== null) next[run.listingId] = run;
        }
        return next;
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to crawl all sources");
    } finally {
      setCrawlAllPending(false);
    }
  }

  async function handleClearSearchData() {
    if (!token) return;
    if (
      !window.confirm(
        "Clear ALL Elasticsearch search data? This deletes every crawled vacancy for every source (not just this one) and resets every source's crawl status back to never-run. Any running crawl is stopped first. This cannot be undone.",
      )
    ) {
      return;
    }
    setClearSearchDataPending(true);
    try {
      await clearSearchData(token);
      // Clearing resets every source's crawl status back to never-run (CrawlRun history is
      // wiped along with the ES data) — refresh so the list doesn't keep showing stale badges.
      if (sources) await loadRuns(sources.map((source) => source.id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to clear search data");
    } finally {
      setClearSearchDataPending(false);
    }
  }

  async function handleClearCache() {
    if (!token) return;
    if (
      !window.confirm(
        "Clear all Redis data (rate limits + page cache)? The next crawl of any source will re-fetch from scratch instead of reusing cached pages.",
      )
    ) {
      return;
    }
    setClearCachePending(true);
    try {
      await clearCache(token);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to clear cache");
    } finally {
      setClearCachePending(false);
    }
  }

  const error = actionError ?? loadError;
  // While either global clear action is in flight, block starting/restarting/stopping any crawl
  // and crawl-all — those actions would race the clear (the backend now rejects/serializes them
  // safely, but disabling here avoids the user hitting a rejected request in the first place).
  const anyClearPending = clearSearchDataPending || clearCachePending;

  if (!token) return null;

  return (
    <main className="flex flex-1 justify-start p-4 md:p-8">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <PageTitle>Sources</PageTitle>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Card>
          <CardHeader>
            <CardTitle>Predefined data sources</CardTitle>
          </CardHeader>
          <CardContent>
            {!sources ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sources.map((source) => {
                  const run = runs[source.id];
                  const detailHref = `/sources/${source.id}`;
                  const hasListings = source.listings.length > 0;
                  const isExpanded = expandedSourceIds.has(source.id);
                  return (
                    <div key={source.id} className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-2 rounded-lg border border-border p-2.5">
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                          <span className="text-sm text-muted-foreground">{source.id}.</span>
                          {hasListings && (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-6 w-6 shrink-0 p-0"
                              title={isExpanded ? "Hide listings" : "Show listings"}
                              onClick={() => toggleExpanded(source.id)}
                            >
                              {isExpanded ? "−" : "+"}
                            </Button>
                          )}
                          <Link
                            href={detailHref}
                            title={detailHref}
                            className="truncate text-sm font-medium underline"
                          >
                            {source.name}
                          </Link>
                          {hasListings && (
                            <span className="text-xs text-muted-foreground">
                              ({source.listings.length} listing{source.listings.length === 1 ? "" : "s"})
                            </span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          {hasListings ? (
                            (() => {
                              const status = aggregateListingStatus(source.listings, listingRuns);
                              const noActiveListings = status === "INACTIVE";
                              return (
                                <>
                                  <StatusBadge status={status} />
                                  {status === "RUNNING" ? (
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      className="w-20"
                                      disabled={bulkPendingSourceIds.has(source.id) || anyClearPending}
                                      onClick={() => handleStopAllListings(source)}
                                    >
                                      Stop
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      className="w-20"
                                      disabled={
                                        noActiveListings || bulkPendingSourceIds.has(source.id) || anyClearPending
                                      }
                                      onClick={() => handleStartAllListings(source)}
                                    >
                                      {status === "PENDING" ? "Start" : "Restart"}
                                    </Button>
                                  )}
                                </>
                              );
                            })()
                          ) : (
                            <>
                              <StatusBadge status={run?.status ?? "PENDING"} />
                              {run?.status === "RUNNING" ? (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="w-20"
                                  disabled={isPending(sourceSlot(source.id)) || anyClearPending}
                                  onClick={() => stop(sourceSlot(source.id))}
                                >
                                  Stop
                                </Button>
                              ) : (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="w-20"
                                  disabled={isPending(sourceSlot(source.id)) || anyClearPending}
                                  onClick={() => start(sourceSlot(source.id))}
                                >
                                  {run ? "Restart" : "Start"}
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      {hasListings && isExpanded && (
                        <div className="ml-6 flex flex-col gap-2">
                          {source.listings.map((listing) => {
                            const listingRun = listingRuns[listing.id];
                            const listingHref = `/sources/${source.id}/listings/${listing.id}`;
                            return (
                              <div
                                key={listing.id}
                                className="grid grid-cols-[1fr_auto_5rem] items-center gap-x-3 rounded-lg border border-border p-2.5"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <Checkbox
                                    checked={listing.isActive}
                                    onCheckedChange={(checked) =>
                                      handleListingActiveChange(source.id, listing, checked === true)
                                    }
                                    title="Active"
                                  />
                                  <Link
                                    href={listingHref}
                                    title={listingHref}
                                    className="truncate text-sm font-medium underline"
                                  >
                                    {listing.label}
                                  </Link>
                                </div>
                                <StatusBadge
                                  className="justify-self-end"
                                  status={listingDisplayStatus(listing, listingRun)}
                                />
                                {listingRun?.status === "RUNNING" ? (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    className="w-20 justify-self-end"
                                    disabled={listingPendingIds.has(listing.id) || anyClearPending}
                                    onClick={() => handleStopListing(source.id, listing.id)}
                                  >
                                    Stop
                                  </Button>
                                ) : (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    className="w-20 justify-self-end"
                                    disabled={
                                      !listing.isActive ||
                                      listingPendingIds.has(listing.id) ||
                                      anyClearPending
                                    }
                                    onClick={() => handleStartListing(source.id, listing.id)}
                                  >
                                    {listingRun ? "Restart" : "Start"}
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-destructive"
                  title="Clear Redis Data"
                  disabled={anyClearPending}
                  onClick={handleClearCache}
                >
                  Clear cache
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-destructive"
                  title="Clear All ES Data"
                  disabled={anyClearPending}
                  onClick={handleClearSearchData}
                >
                  Clear search data
                </Button>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={crawlAllPending || anyClearPending}
                onClick={handleCrawlAll}
              >
                Crawl all
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Strategies</CardTitle>
              <Button variant="secondary" size="sm" onClick={() => setShowStrategies((v) => !v)}>
                {showStrategies ? "Hide strategies" : "Show strategies"}
              </Button>
            </div>
          </CardHeader>
          {showStrategies && (
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Crawling strategy for the sources you select below (up to 2 at a time, so both fit
                side by side).
              </p>
              <div className="flex flex-wrap gap-4">
                {(sources ?? []).map((source) => {
                  const isChecked = comparedSourceNames.has(source.name);
                  const isDisabled = !isChecked && comparedSourceNames.size >= 2;
                  return (
                    <Label key={source.id} className={isDisabled ? undefined : "cursor-pointer"}>
                      <Checkbox
                        checked={isChecked}
                        disabled={isDisabled}
                        onCheckedChange={(checked) => {
                          setComparedSourceNames((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(source.name);
                            else next.delete(source.name);
                            return next;
                          });
                        }}
                      />
                      {source.name}
                    </Label>
                  );
                })}
              </div>
              {comparedSourceNames.size > 0 && (
                <div className="grid gap-4 md:grid-cols-2">
                  {(sources ?? [])
                    .filter((source) => comparedSourceNames.has(source.name))
                    .map((source) => (
                      <div key={source.id} className="rounded-lg border border-border p-3">
                        <p className="mb-2 text-sm font-medium text-foreground">
                          {source.name}{" "}
                          <a
                            href={source.baseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-normal text-link hover:underline"
                          >
                            ({source.baseUrl})
                          </a>
                        </p>
                        <StrategyFlow steps={source.strategySteps} defaultExpanded />
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </main>
  );
}
