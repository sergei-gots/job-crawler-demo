"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { clearSourceData } from "@/features/admin-actions";
import { useCrawlActions } from "@/features/run-crawl";
import { useRequireAuth } from "@/entities/session";
import {
  getSource,
  getSourceRun,
  getSourceVacancies,
  type CrawlRun,
  type CrawlRunWithLogs,
  type Source,
} from "@/entities/source";
import { VacancyCard, vacancyKey, type Vacancy } from "@/entities/vacancy";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StatusBadge } from "@/shared/ui/status-badge";

const POLL_INTERVAL_MS = 2000;
const VACANCIES_PAGE_SIZE = 10;

function formatDelay(delayMs: number): string {
  return `${delayMs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ms`;
}

function typeTooltip(type: Source["type"]): string {
  return type === "DYNAMIC"
    ? "Dynamic (JS-rendered) pages → uses Puppeteer"
    : "Static pages → uses Axios + Cheerio";
}

export function SourceDetailPage({ sourceId }: { sourceId: number }) {
  const { token, handleUnauthorized } = useRequireAuth();
  const [source, setSource] = useState<Source | null>(null);
  const [run, setRun] = useState<CrawlRunWithLogs | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vacancies, setVacancies] = useState<Vacancy[] | null>(null);
  const [vacanciesPage, setVacanciesPage] = useState(1);
  const [showLogs, setShowLogs] = useState(false);
  const [clearDataPending, setClearDataPending] = useState(false);
  const [expandedRawVacancyIds, setExpandedRawVacancyIds] = useState<Set<string>>(new Set());

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
      // Independent requests — run in parallel instead of doubling the round-trip latency.
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

  const { start, stop, pendingId, error: actionError } = useCrawlActions({
    token,
    handleUnauthorized,
    onStarted: patchRun,
    // Stopping leaves RUNNING, so the poll above won't fire again to pick up the final
    // "Stopped by user" log line — refetch once to show it instead of merging the bare CrawlRun.
    onStopped: () => loadRun(),
  });

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

  const actionPending = pendingId === sourceId;
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
                  <StatusBadge status={run?.status ?? "PENDING"} />
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
                    <span className="text-muted-foreground">Type: </span>
                    <span title={typeTooltip(source.type)}>{source.type}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Rate limit: </span>
                    {formatDelay(source.defaultDelayMs)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Pages to crawl: </span>
                    {source.maxPagesToCrawl}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Last run: </span>
                    {run?.startedAt ? new Date(run.startedAt).toLocaleString() : "Never"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
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
                  {run?.status === "RUNNING" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-fit"
                      disabled={actionPending || clearDataPending}
                      onClick={() => stop(sourceId)}
                    >
                      Stop
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-fit"
                      disabled={actionPending || clearDataPending}
                      onClick={() => start(sourceId)}
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
                <CardTitle>Vacancies</CardTitle>
              </CardHeader>
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
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
