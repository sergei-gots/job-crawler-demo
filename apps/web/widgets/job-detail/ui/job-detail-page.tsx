"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { startJob, stopJob } from "@/features/run-job";
import { useRequireAuth } from "@/entities/session";
import { getJob, type JobWithLogs } from "@/entities/job";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StatusBadge } from "@/shared/ui/status-badge";

const POLL_INTERVAL_MS = 2000;

export function JobDetailPage({ jobId }: { jobId: number }) {
  const { token, handleUnauthorized } = useRequireAuth();
  const [job, setJob] = useState<JobWithLogs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const loadJob = useCallback(() => {
    if (!token) return;
    getJob(jobId, token)
      .then(setJob)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          handleUnauthorized();
          return;
        }
        setError("Failed to load job");
      });
  }, [token, jobId, handleUnauthorized]);

  useEffect(() => {
    loadJob();
  }, [loadJob]);

  useEffect(() => {
    if (job?.status !== "RUNNING") return;
    const interval = setInterval(loadJob, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [job?.status, loadJob]);

  async function handleStart() {
    if (!token) return;
    setActionPending(true);
    try {
      await startJob(jobId, token);
      loadJob();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setError("Failed to start job");
    } finally {
      setActionPending(false);
    }
  }

  async function handleStop() {
    if (!token) return;
    setActionPending(true);
    try {
      await stopJob(jobId, token);
      loadJob();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setError("Failed to stop job");
    } finally {
      setActionPending(false);
    }
  }

  if (!token) return null;

  return (
    <main className="flex flex-1 justify-start p-4 md:p-8">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <Link href="/jobs" className="text-sm text-muted-foreground hover:underline">
          &larr; Back to jobs
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
                    <span className="text-muted-foreground">Config: </span>
                    {JSON.stringify(job.config)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Last run: </span>
                    {job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : "Never"}
                  </p>
                </div>
                {job.status === "RUNNING" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    disabled={actionPending}
                    onClick={handleStop}
                  >
                    Stop
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    disabled={actionPending}
                    onClick={handleStart}
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
          </>
        )}
      </div>
    </main>
  );
}
