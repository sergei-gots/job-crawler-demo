"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { clearSourceData } from "@/features/admin-actions";
import {
  updateListingActive,
  updateSourceDelayMs,
  updateSourceMaxVacanciesToCrawl,
  validateDelayMs,
  validateMaxVacanciesToCrawl,
} from "@/features/edit-source-settings";
import {
  sourceSlot,
  startListingCrawl,
  stopListingCrawl,
  useCrawlActions,
} from "@/features/run-crawl";
import { useRequireAuth } from "@/entities/session";
import {
  aggregateListingStatus,
  getListingRun,
  getSource,
  getSourceRun,
  getSourceVacancies,
  StrategyFlow,
  type CrawlRun,
  type CrawlRunWithLogs,
  type Listing,
  type Source,
} from "@/entities/source";
import { VacancyCard, vacancyKey, type Vacancy } from "@/entities/vacancy";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { StatusBadge } from "@/shared/ui/status-badge";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/shared/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

const POLL_INTERVAL_MS = 2000;
const VACANCIES_PAGE_SIZE = 10;

export function SourceDetailPage({ sourceId }: { sourceId: number }) {
  const { token, handleUnauthorized } = useRequireAuth();
  const [source, setSource] = useState<Source | null>(null);
  const [run, setRun] = useState<CrawlRunWithLogs | null>(null);
  const [listingRuns, setListingRuns] = useState<Record<number, CrawlRun | null>>({});
  const [bulkPending, setBulkPending] = useState(false);
  const [listingPendingIds, setListingPendingIds] = useState<Set<number>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vacancies, setVacancies] = useState<Vacancy[] | null>(null);
  const [vacanciesPage, setVacanciesPage] = useState(1);
  const [clearDataPending, setClearDataPending] = useState(false);
  const [expandedRawVacancyIds, setExpandedRawVacancyIds] = useState<Set<string>>(new Set());
  const [maxVacanciesInput, setMaxVacanciesInput] = useState("");
  const [maxVacanciesError, setMaxVacanciesError] = useState<string | null>(null);
  const [maxVacanciesPending, setMaxVacanciesPending] = useState(false);
  // Sync the input from the freshly loaded/saved source value, without an effect (adjust state
  // during render — same pattern as the filters-changed-so-reset-page logic in
  // use-vacancy-search.ts) — `lastLoadedMaxVacancies` tracks what the input was last synced to, so
  // a real change in `source` re-syncs, but the user's own in-progress edit doesn't get clobbered
  // on every render.
  const [lastLoadedMaxVacancies, setLastLoadedMaxVacancies] = useState<number | null>(null);
  if (source && source.maxVacanciesToCrawl !== lastLoadedMaxVacancies) {
    setLastLoadedMaxVacancies(source.maxVacanciesToCrawl);
    setMaxVacanciesInput(String(source.maxVacanciesToCrawl));
  }
  const [delayMsInput, setDelayMsInput] = useState("");
  const [delayMsError, setDelayMsError] = useState<string | null>(null);
  const [delayMsPending, setDelayMsPending] = useState(false);
  // Same adjust-during-render sync pattern as maxPagesInput above.
  const [lastLoadedDelayMs, setLastLoadedDelayMs] = useState<number | null>(null);
  if (source && source.defaultDelayMs !== lastLoadedDelayMs) {
    setLastLoadedDelayMs(source.defaultDelayMs);
    setDelayMsInput(String(source.defaultDelayMs));
  }

  const toggleRawVacancy = useCallback((vacancyKey: string) => {
    setExpandedRawVacancyIds((prev) => {
      const next = new Set(prev);
      if (next.has(vacancyKey)) next.delete(vacancyKey);
      else next.add(vacancyKey);
      return next;
    });
  }, []);

  const loadVacancies = useCallback(async () => {
    if (!token) return;
    try {
      const result = await getSourceVacancies(sourceId, token);
      setVacancies(result);
      setVacanciesPage(1);
    } catch {
      // Non-fatal: the status/log panels above still work even if the vacancy list fails to load.
    }
  }, [token, sourceId]);

  const wasRunningRef = useRef(false);

  const loadRun = useCallback(async () => {
    if (!token) return;
    try {
      const result = await getSourceRun(sourceId, token);
      setRun(result);
      // A completed/stopped run means new vacancies may exist — refresh the list once, right
      // when the transition away from RUNNING is observed (not on every poll tick).
      if (wasRunningRef.current && result?.status !== "RUNNING") {
        void loadVacancies();
      }
      wasRunningRef.current = result?.status === "RUNNING";
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
      }
    }
  }, [token, sourceId, handleUnauthorized, loadVacancies]);

  const loadListingRuns = useCallback(
    async (listingIds: number[]) => {
      if (!token || listingIds.length === 0) return;
      const entries = await Promise.all(
        listingIds.map(async (listingId) => [listingId, await getListingRun(sourceId, listingId, token)] as const),
      );
      setListingRuns((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    },
    [token, sourceId],
  );

  useEffect(() => {
    if (!token) return;
    (async () => {
      let loadedSource: Source | null = null;
      try {
        loadedSource = await getSource(sourceId, token);
        setSource(loadedSource);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          handleUnauthorized();
          return;
        }
        setLoadError("Failed to load source");
      }
      // Independent requests — run in parallel instead of doubling the round-trip latency.
      await Promise.all([
        loadRun(),
        loadVacancies(),
        loadListingRuns(loadedSource?.listings.map((l) => l.id) ?? []),
      ]);
    })();
  }, [token, sourceId, handleUnauthorized, loadRun, loadVacancies, loadListingRuns]);

  const hasRunningListing = Object.values(listingRuns).some((r) => r?.status === "RUNNING");

  useEffect(() => {
    if (run?.status !== "RUNNING" && !hasRunningListing) return;
    const listingIds = source?.listings.map((l) => l.id) ?? [];
    const interval = setInterval(() => {
      loadRun();
      loadListingRuns(listingIds);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [run?.status, hasRunningListing, source?.listings, loadRun, loadListingRuns]);

  useEffect(() => {
    if (run?.status !== "STOPPED") return;
    // `stopSourceCrawl` flips CrawlRun to STOPPED synchronously, but the background task may
    // still be finishing one already-in-flight, rate-limited detail fetch when it does (Stop
    // only stops the *next* iteration from starting — see crawlRunner.ts). The immediate refresh
    // above (triggered by the RUNNING->STOPPED transition) can race that trailing write and miss
    // it, with no further poll afterwards to pick it up. One delayed follow-up, sized to the
    // source's own rate limit plus a buffer for the request itself, catches it.
    const delayMs = (source?.defaultDelayMs ?? 12000) + 10000;
    const timeout = setTimeout(() => {
      void loadRun();
      void loadVacancies();
    }, delayMs);
    return () => clearTimeout(timeout);
  }, [run?.status, source?.defaultDelayMs, loadRun, loadVacancies]);

  const patchRun = useCallback((updated: CrawlRun) => {
    // The server clears CrawlLog history when a run (re)starts; reflect that immediately instead
    // of waiting for the next poll. Subsequent log lines arrive via the RUNNING poll above.
    wasRunningRef.current = updated.status === "RUNNING";
    setRun({ ...updated, logs: [] });
  }, []);

  const { start, stop, isPending, error: actionError } = useCrawlActions({
    token,
    handleUnauthorized,
    onStarted: patchRun,
    // Stopping leaves RUNNING, so the poll above won't fire again to pick up the final
    // "Stopped by user" log line — refetch once to show it instead of merging the bare CrawlRun.
    onStopped: () => loadRun(),
  });

  async function handleStartListing(listingId: number) {
    if (!token || !source) return;
    setListingPendingIds((prev) => new Set(prev).add(listingId));
    try {
      const r = await startListingCrawl(source.id, listingId, token);
      setListingRuns((prev) => ({ ...prev, [listingId]: r }));
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

  async function handleStopListing(listingId: number) {
    if (!token || !source) return;
    setListingPendingIds((prev) => new Set(prev).add(listingId));
    try {
      const r = await stopListingCrawl(source.id, listingId, token);
      setListingRuns((prev) => ({ ...prev, [listingId]: r }));
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

  async function handleStartAllListings() {
    if (!token || !source) return;
    setBulkPending(true);
    try {
      const toStart = source.listings.filter(
        (listing) => listing.isActive && listingRuns[listing.id]?.status !== "RUNNING",
      );
      const startedRuns = await Promise.all(
        toStart.map((listing) => startListingCrawl(source.id, listing.id, token)),
      );
      setListingRuns((prev) => {
        const next = { ...prev };
        for (const r of startedRuns) next[r.listingId as number] = r;
        return next;
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to start listing crawls");
    } finally {
      setBulkPending(false);
    }
  }

  async function handleStopAllListings() {
    if (!token || !source) return;
    setBulkPending(true);
    try {
      const toStop = source.listings.filter((listing) => listingRuns[listing.id]?.status === "RUNNING");
      const stoppedRuns = await Promise.all(
        toStop.map((listing) => stopListingCrawl(source.id, listing.id, token)),
      );
      setListingRuns((prev) => {
        const next = { ...prev };
        for (const r of stoppedRuns) next[r.listingId as number] = r;
        return next;
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to stop listing crawls");
    } finally {
      setBulkPending(false);
    }
  }

  async function handleListingActiveChange(listing: Listing, isActive: boolean) {
    if (!token || !source) return;
    try {
      const updated = await updateListingActive(source.id, listing.id, isActive, token);
      setSource((prev) =>
        prev
          ? { ...prev, listings: prev.listings.map((l) => (l.id === updated.id ? updated : l)) }
          : prev,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to update listing");
    }
  }

  async function handleClearData() {
    if (!token) return;
    if (
      !window.confirm(
        `Clear all data for "${source?.name ?? "this source"}"? This deletes its crawled vacancies from Elasticsearch and resets its crawl status back to never-run. If a crawl is currently running for it, that crawl is stopped first. This cannot be undone.`,
      )
    ) {
      return;
    }
    setClearDataPending(true);
    try {
      await clearSourceData(sourceId, token);
      // The backend stops an in-progress crawl, deletes ES data, and deletes this source's
      // CrawlRun/CrawlLog history — refresh both so the UI reflects the fresh "never run" state.
      await Promise.all([loadRun(), loadVacancies()]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to clear source data");
    } finally {
      setClearDataPending(false);
    }
  }

  async function handleSaveMaxVacancies() {
    if (!token) return;
    const parsed = Number(maxVacanciesInput);
    const validationError = validateMaxVacanciesToCrawl(parsed);
    if (validationError) {
      setMaxVacanciesError(validationError);
      return;
    }
    setMaxVacanciesError(null);
    setMaxVacanciesPending(true);
    try {
      setSource(await updateSourceMaxVacanciesToCrawl(sourceId, parsed, token));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setMaxVacanciesError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setMaxVacanciesPending(false);
    }
  }

  async function handleSaveDelayMs() {
    if (!token) return;
    const parsed = Number(delayMsInput);
    const validationError = validateDelayMs(parsed);
    if (validationError) {
      setDelayMsError(validationError);
      return;
    }
    setDelayMsError(null);
    setDelayMsPending(true);
    try {
      setSource(await updateSourceDelayMs(sourceId, parsed, token));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setDelayMsError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setDelayMsPending(false);
    }
  }

  const hasListings = (source?.listings.length ?? 0) > 0;
  const actionPending = isPending(sourceSlot(sourceId));
  const error = actionError ?? loadError;
  const pagedVacancies = (vacancies ?? []).slice(
    (vacanciesPage - 1) * VACANCIES_PAGE_SIZE,
    vacanciesPage * VACANCIES_PAGE_SIZE,
  );
  const totalVacancyPages = Math.ceil((vacancies?.length ?? 0) / VACANCIES_PAGE_SIZE);

  if (!token) return null;

  return (
    <main className="flex flex-1 justify-start p-4 md:p-8">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <Link href="/sources" className="text-sm text-muted-foreground hover:underline">
          &larr; Back to sources
        </Link>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!source ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{source.name}</CardTitle>
                  <StatusBadge
                    status={
                      (hasListings
                        ? aggregateListingStatus(source.listings, listingRuns)
                        : run?.status) ?? "PENDING"
                    }
                  />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-col gap-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Source ID: </span>
                    {source.id}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Base URL: </span>
                    <a
                      href={source.baseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-link hover:underline"
                    >
                      {source.baseUrl}
                    </a>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Implementation: </span>
                    <span>{source.strategyDescription ?? "Not implemented yet"}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Rate limit: </span>
                    <Input
                      type="number"
                      min={1000}
                      max={20000}
                      value={delayMsInput}
                      onChange={(e) => {
                        setDelayMsInput(e.target.value);
                        setDelayMsError(null);
                      }}
                      className="h-7 w-24 px-2 py-1"
                      disabled={delayMsPending}
                    />
                    <span className="text-muted-foreground">ms</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={delayMsPending || delayMsInput === String(source.defaultDelayMs)}
                      onClick={handleSaveDelayMs}
                    >
                      {delayMsPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                  {delayMsError && <p className="text-sm text-destructive">{delayMsError}</p>}
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Vacancies to crawl: </span>
                    <Input
                      type="number"
                      min={1}
                      max={200}
                      value={maxVacanciesInput}
                      onChange={(e) => {
                        setMaxVacanciesInput(e.target.value);
                        setMaxVacanciesError(null);
                      }}
                      className="h-7 w-16 px-2 py-1"
                      disabled={maxVacanciesPending}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={
                        maxVacanciesPending ||
                        maxVacanciesInput === String(source.maxVacanciesToCrawl)
                      }
                      onClick={handleSaveMaxVacancies}
                    >
                      {maxVacanciesPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                  {maxVacanciesError && (
                    <p className="text-sm text-destructive">{maxVacanciesError}</p>
                  )}
                  <p>
                    <span className="text-muted-foreground">Last run: </span>
                    {run?.startedAt ? new Date(run.startedAt).toLocaleString() : "Never"}
                  </p>
                </div>
                {hasListings && (
                  <div className="flex flex-col gap-1 text-sm">
                    <p className="text-muted-foreground">
                      This source crawls at the listing level:
                    </p>
                    {source.listings.map((listing) => {
                      const listingRun = listingRuns[listing.id];
                      return (
                        <div
                          key={listing.id}
                          className="grid grid-cols-[1fr_auto_5rem] items-center gap-x-3"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Checkbox
                              checked={listing.isActive}
                              onCheckedChange={(checked) =>
                                handleListingActiveChange(listing, checked === true)
                              }
                              title="Active"
                            />
                            <Link
                              href={`/sources/${sourceId}/listings/${listing.id}`}
                              className="text-link hover:underline"
                            >
                              {listing.label}
                            </Link>
                          </div>
                          <StatusBadge
                            className="justify-self-end"
                            status={listing.isActive ? (listingRun?.status ?? "PENDING") : "INACTIVE"}
                          />
                          {listingRun?.status === "RUNNING" ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="w-20 justify-self-end"
                              disabled={
                                !listing.isActive ||
                                listingPendingIds.has(listing.id) ||
                                clearDataPending
                              }
                              onClick={() => handleStopListing(listing.id)}
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
                                clearDataPending
                              }
                              onClick={() => handleStartListing(listing.id)}
                            >
                              {listingRun ? "Restart" : "Start"}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-fit text-destructive"
                    title="Clear ES Data"
                    disabled={clearDataPending}
                    onClick={handleClearData}
                  >
                    Clear data
                  </Button>
                  {hasListings ? (
                    aggregateListingStatus(source.listings, listingRuns) === "RUNNING" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-fit"
                        disabled={bulkPending || clearDataPending}
                        onClick={handleStopAllListings}
                      >
                        Stop all
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-fit"
                        disabled={
                          aggregateListingStatus(source.listings, listingRuns) === "INACTIVE" ||
                          bulkPending ||
                          clearDataPending
                        }
                        onClick={handleStartAllListings}
                      >
                        {aggregateListingStatus(source.listings, listingRuns) === "PENDING"
                          ? "Start all"
                          : "Restart all"}
                      </Button>
                    )
                  ) : run?.status === "RUNNING" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-fit"
                      disabled={actionPending || clearDataPending}
                      onClick={() => stop(sourceSlot(sourceId))}
                    >
                      Stop
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-fit"
                      disabled={actionPending || clearDataPending}
                      onClick={() => start(sourceSlot(sourceId))}
                    >
                      {run ? "Restart" : "Start"}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Tabs defaultValue="strategy">
                  <TabsList>
                    <Tooltip>
                      <TooltipTrigger className="cursor-pointer border-none">
                        <TabsTab value="strategy">Strategy</TabsTab>
                      </TooltipTrigger>
                      <TooltipContent>
                        The CrawlStrategy actually used to crawl this source, step by step.
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger className="cursor-pointer border-none">
                        <TabsTab value="logs">Logs</TabsTab>
                      </TooltipTrigger>
                      <TooltipContent>
                        Line-by-line execution log of the most recent crawl run (fetch/parse/enrich
                        steps).
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger className="cursor-pointer border-none">
                        <TabsTab value="vacancies">Vacancies</TabsTab>
                      </TooltipTrigger>
                      <TooltipContent>
                        Vacancies upserted into Elasticsearch by this source, deduplicated by source +
                        external ID.
                      </TooltipContent>
                    </Tooltip>
                  </TabsList>

                  <TabsPanel value="strategy">
                    <StrategyFlow steps={source.strategySteps} />
                  </TabsPanel>

                  <TabsPanel value="logs">
                    {!run || run.logs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No logs yet.</p>
                    ) : (
                      <div className="flex flex-col gap-1 font-mono text-xs">
                        {run.logs.map((log) => (
                          <p
                            key={log.id}
                            className={log.level === "ERROR" ? "text-destructive" : "text-foreground"}
                          >
                            <span className="text-muted-foreground">
                              {new Date(log.createdAt).toLocaleTimeString()}
                            </span>{" "}
                            {log.message}
                          </p>
                        ))}
                      </div>
                    )}
                  </TabsPanel>

                  <TabsPanel value="vacancies">
                    {!vacancies ? (
                      <p className="text-sm text-muted-foreground">Loading...</p>
                    ) : vacancies.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No vacancies found yet.</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {pagedVacancies.map((vacancy, index) => {
                          const key = vacancyKey(vacancy);
                          const ordinal = (vacanciesPage - 1) * VACANCIES_PAGE_SIZE + index + 1;
                          return (
                            <VacancyCard
                              key={key}
                              vacancy={vacancy}
                              ordinal={ordinal}
                              isRawExpanded={expandedRawVacancyIds.has(key)}
                              onToggleRaw={() => toggleRawVacancy(key)}
                            />
                          );
                        })}
                      </div>
                    )}
                    {vacancies && vacancies.length > VACANCIES_PAGE_SIZE && (
                      <div className="mt-3 flex items-center justify-between">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={vacanciesPage === 1}
                          onClick={() => setVacanciesPage((p) => p - 1)}
                        >
                          Previous
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Page {vacanciesPage} of {totalVacancyPages}
                        </p>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={vacanciesPage >= totalVacancyPages}
                          onClick={() => setVacanciesPage((p) => p + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    )}
                  </TabsPanel>
                </Tabs>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
