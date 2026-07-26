"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CreateJobForm } from "@/features/create-crawler-job";
import { useCrawlerJobActions } from "@/features/run-crawler-job";
import { useRequireAuth } from "@/entities/session";
import { getCrawlerJobs, type CrawlerJob } from "@/entities/crawler-job";
import { getSources, type Source } from "@/entities/source";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { PageTitle } from "@/shared/ui/page-title";
import { StatusBadge } from "@/shared/ui/status-badge";

const POLL_INTERVAL_MS = 2000;

export function CrawlerJobsPage() {
  const { token, handleUnauthorized } = useRequireAuth();
  const [jobs, setJobs] = useState<CrawlerJob[] | null>(null);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleAuthError = useCallback(
    (err: unknown, fallbackMessage: string) => {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setLoadError(fallbackMessage);
    },
    [handleUnauthorized],
  );

  const loadJobs = useCallback(async () => {
    if (!token) return;
    try {
      const result = await getCrawlerJobs(token);
      setJobs(result);
    } catch (err) {
      handleAuthError(err, "Failed to load crawler jobs");
    }
  }, [token, handleAuthError]);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount, matches entities/session/lib/use-require-auth.ts
    loadJobs();
    (async () => {
      try {
        const result = await getSources(token);
        setSources(result);
      } catch (err) {
        handleAuthError(err, "Failed to load sources");
      }
    })();
  }, [token, loadJobs, handleAuthError]);

  const hasRunningJob = jobs?.some((job) => job.status === "RUNNING") ?? false;

  useEffect(() => {
    if (!hasRunningJob) return;
    const interval = setInterval(loadJobs, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasRunningJob, loadJobs]);

  const patchJob = useCallback((updated: CrawlerJob) => {
    setJobs((prev) => (prev ? prev.map((job) => (job.id === updated.id ? updated : job)) : prev));
  }, []);

  const { start, stop, pendingId, error: actionError } = useCrawlerJobActions({
    token,
    handleUnauthorized,
    onStarted: patchJob,
    onStopped: patchJob,
  });

  const error = actionError ?? loadError;

  if (!token) return null;

  return (
    <main className="flex flex-1 justify-start p-4 md:p-8">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <PageTitle>Crawler jobs</PageTitle>
        {error && <p className="text-sm text-red-500">{error}</p>}

        <Card>
          <CardHeader>
            <CardTitle>Your crawler jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {!jobs ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No crawler jobs yet. Create one below.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Link
                        href={`/crawler-jobs/${job.id}`}
                        title={job.description ?? undefined}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {job.name}
                      </Link>
                      <p className="shrink-0 text-xs text-muted-foreground">
                        {job.lastRunAt ? `Last run: ${new Date(job.lastRunAt).toLocaleString()}` : "Never run"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={job.status} />
                      {job.status === "RUNNING" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pendingId === job.id}
                          onClick={() => stop(job.id)}
                        >
                          Stop
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pendingId === job.id}
                          onClick={() => start(job.id)}
                        >
                          {job.status === "PENDING" ? "Start" : "Restart"}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {sources && (
          <CreateJobForm
            sources={sources}
            token={token}
            onCreated={(job) => setJobs((prev) => (prev ? [job, ...prev] : [job]))}
          />
        )}
      </div>
    </main>
  );
}
