"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CreateJobForm } from "@/features/create-crawler-job";
import { startJob, stopJob } from "@/features/run-job";
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
  const [error, setError] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<number | null>(null);

  const handleAuthError = useCallback(
    (err: unknown, fallbackMessage: string) => {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setError(fallbackMessage);
    },
    [handleUnauthorized],
  );

  const loadJobs = useCallback(() => {
    if (!token) return;
    getJobs(token)
      .then(setJobs)
      .catch((err) => handleAuthError(err, "Failed to load jobs"));
  }, [token, handleAuthError]);

  useEffect(() => {
    if (!token) return;
    loadJobs();
    getSources(token)
      .then(setSources)
      .catch((err) => handleAuthError(err, "Failed to load sources"));
  }, [token, loadJobs, handleAuthError]);

  async function handleStart(id: number) {
    if (!token) return;
    setPendingActionId(id);
    try {
      await startJob(id, token);
      loadJobs();
    } catch (err) {
      handleAuthError(err, "Failed to start job");
    } finally {
      setPendingActionId(null);
    }
  }

  async function handleStop(id: number) {
    if (!token) return;
    setPendingActionId(id);
    try {
      await stopJob(id, token);
      loadJobs();
    } catch (err) {
      handleAuthError(err, "Failed to stop job");
    } finally {
      setPendingActionId(null);
    }
  }

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
                          disabled={pendingActionId === job.id}
                          onClick={() => handleStop(job.id)}
                        >
                          Stop
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pendingActionId === job.id}
                          onClick={() => handleStart(job.id)}
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
