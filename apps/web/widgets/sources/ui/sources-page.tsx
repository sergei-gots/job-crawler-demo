"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { crawlAll, useCrawlActions } from "@/features/run-crawl";
import { useRequireAuth } from "@/entities/session";
import { getSourceRun, getSources, type CrawlRun, type Source } from "@/entities/source";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { PageTitle } from "@/shared/ui/page-title";
import { StatusBadge } from "@/shared/ui/status-badge";

const POLL_INTERVAL_MS = 2000;

function typeTooltip(type: Source["type"]): string {
  return type === "DYNAMIC"
    ? "Dynamic (JS-rendered) pages → uses Puppeteer"
    : "Static pages → uses Axios + Cheerio";
}

function formatDelay(delayMs: number): string {
  return `${delayMs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ms`;
}

export function SourcesPage() {
  const { token, handleUnauthorized } = useRequireAuth();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [runs, setRuns] = useState<Record<number, CrawlRun | null>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [crawlAllPending, setCrawlAllPending] = useState(false);

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

  const error = actionError ?? loadError;

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
              <Button
                variant="secondary"
                size="sm"
                disabled={crawlAllPending}
                onClick={handleCrawlAll}
              >
                Crawl all
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {!sources ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sources.map((source) => {
                  const run = runs[source.id];
                  return (
                    <div
                      key={source.id}
                      className="flex flex-wrap items-center justify-between gap-y-2 gap-x-2 rounded-lg border border-border p-2.5"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <Link
                          href={`/sources/${source.id}`}
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {source.name}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          <a
                            href={source.baseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-link hover:underline"
                          >
                            {source.baseUrl}
                          </a>
                          {" - "}
                          <span title={typeTooltip(source.type)}>{source.type}</span>
                          {" - "}
                          {formatDelay(source.defaultDelayMs)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <StatusBadge status={run?.status ?? "PENDING"} />
                        {run?.status === "RUNNING" ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="w-20"
                            disabled={pendingId === source.id}
                            onClick={() => stop(source.id)}
                          >
                            Stop
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="w-20"
                            disabled={pendingId === source.id}
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
      </div>
    </main>
  );
}
