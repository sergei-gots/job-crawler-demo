"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { listingSlot, useCrawlActions } from "@/features/run-crawl";
import { updateListingActive } from "@/features/edit-source-settings";
import { clearListingCache } from "@/features/admin-actions";
import { useRequireAuth } from "@/entities/session";
import {
  getListingRun,
  getListingVacancies,
  getSource,
  type CrawlRun,
  type CrawlRunWithLogs,
  type Source,
} from "@/entities/source";
import { VacancyCard, vacancyKey, type Vacancy } from "@/entities/vacancy";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Label } from "@/shared/ui/label";
import { StatusBadge } from "@/shared/ui/status-badge";

const POLL_INTERVAL_MS = 2000;
const VACANCIES_PAGE_SIZE = 10;

export function ListingDetailPage({ sourceId, listingId }: { sourceId: number; listingId: number }) {
  const { token, handleUnauthorized } = useRequireAuth();
  const [source, setSource] = useState<Source | null>(null);
  const [run, setRun] = useState<CrawlRunWithLogs | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vacancies, setVacancies] = useState<Vacancy[] | null>(null);
  const [vacanciesPage, setVacanciesPage] = useState(1);
  const [showLogs, setShowLogs] = useState(false);
  const [showVacancies, setShowVacancies] = useState(false);
  const [expandedRawVacancyIds, setExpandedRawVacancyIds] = useState<Set<string>>(new Set());
  const [activePending, setActivePending] = useState(false);
  const [clearCachePending, setClearCachePending] = useState(false);

  const listing = source?.listings.find((l) => l.id === listingId) ?? null;

  const toggleRawVacancy = useCallback((key: string) => {
    setExpandedRawVacancyIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const loadVacancies = useCallback(async () => {
    if (!token) return;
    try {
      // Best-effort: only vacancies whose most recent upsert was attributed to this listing (see
      // CrawlerResultDoc.listingId's v4 schema note) — a posting that also appears in another of
      // this source's listings, but was last crawled by that one instead, won't show here even
      // though it's still live in this listing's category too.
      const result = await getListingVacancies(sourceId, listingId, token);
      setVacancies(result);
      setVacanciesPage(1);
    } catch {
      // Non-fatal: the status/log panels above still work even if the vacancy list fails to load.
    }
  }, [token, sourceId, listingId]);

  const wasRunningRef = useRef(false);

  const loadRun = useCallback(async () => {
    if (!token) return;
    try {
      const result = await getListingRun(sourceId, listingId, token);
      setRun(result);
      if (wasRunningRef.current && result?.status !== "RUNNING") {
        void loadVacancies();
      }
      wasRunningRef.current = result?.status === "RUNNING";
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
      }
    }
  }, [token, sourceId, listingId, handleUnauthorized, loadVacancies]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        setSource(await getSource(sourceId, token));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          handleUnauthorized();
          return;
        }
        setLoadError("Failed to load source");
      }
      await Promise.all([loadRun(), loadVacancies()]);
    })();
  }, [token, sourceId, handleUnauthorized, loadRun, loadVacancies]);

  useEffect(() => {
    if (run?.status !== "RUNNING") return;
    const interval = setInterval(loadRun, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [run?.status, loadRun]);

  useEffect(() => {
    if (run?.status !== "STOPPED") return;
    const delayMs = (source?.defaultDelayMs ?? 12000) + 10000;
    const timeout = setTimeout(() => {
      void loadRun();
      void loadVacancies();
    }, delayMs);
    return () => clearTimeout(timeout);
  }, [run?.status, source?.defaultDelayMs, loadRun, loadVacancies]);

  const patchRun = useCallback((updated: CrawlRun) => {
    wasRunningRef.current = updated.status === "RUNNING";
    setRun({ ...updated, logs: [] });
  }, []);

  const { start, stop, isPending, error: actionError } = useCrawlActions({
    token,
    handleUnauthorized,
    onStarted: patchRun,
    onStopped: () => loadRun(),
  });

  async function handleActiveChange(isActive: boolean) {
    if (!token || !listing) return;
    setActivePending(true);
    try {
      const updated = await updateListingActive(sourceId, listing.id, isActive, token);
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
    } finally {
      setActivePending(false);
    }
  }

  async function handleClearCache() {
    if (!token) return;
    if (
      !window.confirm(
        "Clear this listing's page cache (its own listing page plus every one of its vacancies' detail pages)? The next crawl will re-fetch from scratch instead of reusing cached pages.",
      )
    ) {
      return;
    }
    setClearCachePending(true);
    try {
      await clearListingCache(sourceId, listingId, token);
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

  const actionPending = isPending(listingSlot(sourceId, listingId));
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
        <Link
          href={`/sources/${sourceId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to {source?.name ?? "source"}
        </Link>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!source || !listing ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex flex-col gap-0.5">
                    <Link
                      href={`/sources/${sourceId}`}
                      className="text-sm font-semibold text-muted-foreground hover:underline"
                    >
                      {source.name}
                    </Link>
                    <span>&#8627; {listing.label}</span>
                  </CardTitle>
                  <StatusBadge status={run?.status ?? "PENDING"} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-col gap-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Listing URL: </span>
                    <a
                      href={new URL(listing.subPath, source.baseUrl).toString()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-link hover:underline"
                    >
                      {listing.subPath}
                    </a>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Last run: </span>
                    {run?.startedAt ? new Date(run.startedAt).toLocaleString() : "Never"}
                  </p>
                  <Label className="flex w-fit cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={listing.isActive}
                      disabled={activePending}
                      onCheckedChange={(checked) => handleActiveChange(checked === true)}
                    />
                    Active
                  </Label>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-fit text-destructive"
                    title="Clear this listing's page cache"
                    disabled={clearCachePending}
                    onClick={handleClearCache}
                  >
                    Clear cache
                  </Button>
                  {run?.status === "RUNNING" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-fit"
                      disabled={actionPending}
                      onClick={() => stop(listingSlot(sourceId, listingId))}
                    >
                      Stop
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-fit"
                      disabled={actionPending}
                      onClick={() => start(listingSlot(sourceId, listingId))}
                    >
                      {run ? "Restart" : "Start"}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Execution logs</CardTitle>
                  <Button variant="secondary" size="sm" onClick={() => setShowLogs((v) => !v)}>
                    {showLogs ? "Hide logs" : "Show logs"}
                  </Button>
                </div>
              </CardHeader>
              {showLogs && (
                <CardContent>
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
                </CardContent>
              )}
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Vacancies</CardTitle>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowVacancies((v) => !v)}
                  >
                    {showVacancies ? "Hide vacancies" : "Show vacancies"}
                  </Button>
                </div>
              </CardHeader>
              {showVacancies && (
                <CardContent>
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
                </CardContent>
              )}
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
