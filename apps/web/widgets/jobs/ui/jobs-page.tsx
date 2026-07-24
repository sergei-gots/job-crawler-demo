"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CreateJobForm } from "@/features/create-crawler-job";
import { useJobActions } from "@/features/run-job";
import { useRequireAuth } from "@/entities/session";
import { getJobs, type Job } from "@/entities/job";
import { getSources, type Source } from "@/entities/source";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StatusBadge } from "@/shared/ui/status-badge";

export function JobsPage() {
  const { token, handleUnauthorized } = useRequireAuth();
  const [jobs, setJobs] = useState<Job[] | null>(null);
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
      const result = await getJobs(token);
      setJobs(result);
    } catch (err) {
      handleAuthError(err, "Failed to load jobs");
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

  const patchJob = useCallback((updated: Job) => {
    setJobs((prev) => (prev ? prev.map((job) => (job.id === updated.id ? updated : job)) : prev));
  }, []);

  const { start, stop, pendingId, error: actionError } = useJobActions({
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
        <h1 className="text-2xl font-semibold">Crawler jobs</h1>
        {error && <p className="text-sm text-red-500">{error}</p>}

        <Card>
          <CardHeader>
            <CardTitle>Your jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {!jobs ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No jobs yet. Create one below.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between rounded-lg border border-border p-2.5"
                  >
                    <div className="flex flex-col gap-0.5">
                      <Link href={`/jobs/${job.id}`} className="text-sm font-medium hover:underline">
                        {job.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {job.lastRunAt ? `Last run: ${new Date(job.lastRunAt).toLocaleString()}` : "Never run"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={job.status} />
                      {job.status === "RUNNING" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pendingId === job.id}
                          onClick={() => stop(job.id)}
                        >
                          Stop
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pendingId === job.id}
                          onClick={() => start(job.id)}
                        >
                          Start
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
