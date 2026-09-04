"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { clearCache, clearSearchData } from "@/features/admin-actions";
import { crawlAll, useCrawlActions } from "@/features/run-crawl";
import { useRequireAuth } from "@/entities/session";
import { getSourceRun, getSources, StrategyFlow, type CrawlRun, type Source } from "@/entities/source";
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

  const loadSources = useCallback(async () => {
    if (!token) return;
    try {
      const result = await getSources(token);
      setSources(result);
      await loadRuns(result.map((source) => source.id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to load sources");
    }
  }, [token, handleUnauthorized, loadRuns]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount, matches entities/session/lib/use-require-auth.ts
    loadSources();
  }, [loadSources]);

  const hasRunningSource = Object.values(runs).some((run) => run?.status === "RUNNING");

  useEffect(() => {
    if (!hasRunningSource || !sources) return;
    const sourceIds = sources.map((source) => source.id);
    const interval = setInterval(() => loadRuns(sourceIds), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasRunningSource, sources, loadRuns]);

  const patchRun = useCallback((run: CrawlRun) => {
    setRuns((prev) => ({ ...prev, [run.sourceId]: run }));
  }, []);

  const { start, stop, pendingId, error: actionError } = useCrawlActions({
    token,
    handleUnauthorized,
    onStarted: patchRun,
    onStopped: patchRun,
  });

  async function handleCrawlAll() {
    if (!token) return;
    setCrawlAllPending(true);
    try {
      const startedRuns = await crawlAll(token);
      setRuns((prev) => {
        const next = { ...prev };
        for (const run of startedRuns) next[run.sourceId] = run;
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
            <div className="flex items-center justify-between">
              <CardTitle>Predefined data sources</CardTitle>
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
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={crawlAllPending || anyClearPending}
                  onClick={handleCrawlAll}
                >
                  Crawl all
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!sources ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sources.map((source) => {
                  const run = runs[source.id];
                  const detailHref = `/sources/${source.id}`;
                  return (
                    <div
                      key={source.id}
                      className="flex flex-wrap items-center justify-between gap-y-2 gap-x-2 rounded-lg border border-border p-2.5"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <span className="text-sm text-muted-foreground">{source.id}.</span>
                        <Link
                          href={detailHref}
                          title={detailHref}
                          className="truncate text-sm font-medium underline"
                        >
                          {source.name}
                        </Link>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <StatusBadge status={run?.status ?? "PENDING"} />
                        {run?.status === "RUNNING" ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="w-20"
                            disabled={pendingId === source.id || anyClearPending}
                            onClick={() => stop(source.id)}
                          >
                            Stop
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="w-20"
                            disabled={pendingId === source.id || anyClearPending}
                            onClick={() => start(source.id)}
                          >
                            {run ? "Restart" : "Start"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
                Crawling strategy for the sources you select below.
              </p>
              <div className="flex flex-wrap gap-4">
                {(sources ?? []).map((source) => (
                  <Label key={source.id} className="cursor-pointer">
                    <Checkbox
                      checked={comparedSourceNames.has(source.name)}
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
                ))}
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
                        <StrategyFlow steps={source.strategySteps} />
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
