"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useCrawlerJobActions } from "@/features/run-crawler-job";
import { useRequireAuth } from "@/entities/session";
import {
  getCrawlerJob,
  getCrawlerJobVacancies,
  type CrawlerJob,
  type CrawlerJobWithLogs,
  type Vacancy,
} from "@/entities/crawler-job";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StatusBadge } from "@/shared/ui/status-badge";

const POLL_INTERVAL_MS = 2000;

export function CrawlerJobDetailPage({ jobId }: { jobId: number }) {
  const { token, handleUnauthorized } = useRequireAuth();
  const [job, setJob] = useState<CrawlerJobWithLogs | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vacancies, setVacancies] = useState<Vacancy[] | null>(null);

  const loadVacancies = useCallback(async () => {
    if (!token) return;
    try {
      const result = await getCrawlerJobVacancies(jobId, token);
      setVacancies(result);
    } catch {
      // Non-fatal: the job/log panel above still works even if the vacancy list fails to load.
    }
  }, [token, jobId]);

  const loadJob = useCallback(async () => {
    if (!token) return;
    try {
      const result = await getCrawlerJob(jobId, token);
      setJob(result);
      void loadVacancies();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError("Failed to load crawler job");
    }
  }, [token, jobId, handleUnauthorized, loadVacancies]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount, matches entities/session/lib/use-require-auth.ts
    loadJob();
  }, [loadJob]);

  useEffect(() => {
    if (job?.status !== "RUNNING") return;
    const interval = setInterval(loadJob, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [job?.status, loadJob]);

  const applyStarted = useCallback((updated: CrawlerJob) => {
    // The server clears JobLog history when a run (re)starts; reflect that immediately instead
    // of waiting for the next poll. Subsequent log lines arrive via the RUNNING poll above.
    setJob((prev) => (prev ? { ...prev, ...updated, logs: [] } : prev));
  }, []);

  const { start, stop, pendingId, error: actionError } = useCrawlerJobActions({
    token,
    handleUnauthorized,
    onStarted: applyStarted,
    // Stopping leaves RUNNING, so the poll above won't fire again to pick up the final
    // "Stopped by user" log line — refetch once to show it instead of merging the bare CrawlerJob.
    onStopped: () => loadJob(),
  });

  const actionPending = pendingId === jobId;
  const error = actionError ?? loadError;

  if (!token) return null;

  return (
    <main className="flex flex-1 justify-start p-4 md:p-8">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <Link href="/crawler-jobs" className="text-sm text-muted-foreground hover:underline">
          &larr; Back to crawler jobs
        </Link>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!job ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{job.name}</CardTitle>
                  <StatusBadge status={job.status} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {job.description && (
                  <p className="text-sm text-muted-foreground">{job.description}</p>
                )}
                <div className="flex flex-col gap-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Keywords: </span>
                    {job.keywords ?? "—"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Sources: </span>
                    {job.sources.join(", ")}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Last run: </span>
                    {job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : "Never"}
                  </p>
                </div>
                {job.status === "RUNNING" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-fit"
                    disabled={actionPending}
                    onClick={() => stop(jobId)}
                  >
                    Stop
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-fit"
                    disabled={actionPending}
                    onClick={() => start(jobId)}
                  >
                    Start
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Execution logs</CardTitle>
              </CardHeader>
              <CardContent>
                {job.logs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No logs yet.</p>
                ) : (
                  <div className="flex flex-col gap-1 font-mono text-xs">
                    {job.logs.map((log) => (
                      <p key={log.id} className="text-foreground">
                        <span className="text-muted-foreground">
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </span>{" "}
                        {log.message}
                      </p>
                    ))}
                  </div>
                )}
              </CardContent>
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
                    {vacancies.map((vacancy) => (
                      <div
                        key={`${vacancy.sourceId}:${vacancy.externalId}`}
                        className="rounded-lg border border-border p-2.5"
                      >
                        <a
                          href={vacancy.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-link hover:underline"
                        >
                          {vacancy.title}
                        </a>
                        <p className="text-xs text-muted-foreground">
                          {vacancy.company ?? "Unknown company"}
                          {vacancy.postedAt &&
                            ` — posted ${new Date(vacancy.postedAt).toLocaleDateString()}`}
                        </p>
                      </div>
                    ))}
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
