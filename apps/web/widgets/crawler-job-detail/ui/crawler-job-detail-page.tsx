"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useCrawlerJobActions } from "@/features/run-crawler-job";
import { useDeleteCrawlerJob } from "@/features/delete-crawler-job";
import { EditJobForm } from "@/features/edit-crawler-job";
import { useRequireAuth } from "@/entities/session";
import {
  getCrawlerJob,
  getCrawlerJobVacancies,
  type CrawlerJob,
  type CrawlerJobWithLogs,
  type Vacancy,
} from "@/entities/crawler-job";
import { getSources, type Source } from "@/entities/source";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StatusBadge } from "@/shared/ui/status-badge";

const POLL_INTERVAL_MS = 2000;

export function CrawlerJobDetailPage({ jobId }: { jobId: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, handleUnauthorized } = useRequireAuth();
  const [job, setJob] = useState<CrawlerJobWithLogs | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vacancies, setVacancies] = useState<Vacancy[] | null>(null);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [isEditing, setIsEditing] = useState(searchParams.get("edit") === "1");
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
    if (!token) return;
    getSources(token)
      .then(setSources)
      .catch(() => {
        // Non-fatal: falls back to showing raw source ids below.
      });
  }, [token]);

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

  const { remove: removeJob, pendingId: deletePendingId, error: deleteError } = useDeleteCrawlerJob({
    token,
    handleUnauthorized,
    onDeleted: () => router.push("/crawler-jobs"),
  });

  const actionPending = pendingId === jobId;
  const error = actionError ?? deleteError ?? loadError;

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
        ) : isEditing && sources ? (
          <EditJobForm
            job={job}
            sources={sources}
            token={token}
            onSaved={(updated) => {
              setJob((prev) => (prev ? { ...prev, ...updated } : prev));
              setIsEditing(false);
              // Keyword/source filtering happens read-time (ES query), so the vacancy list must
              // be re-fetched now — otherwise it keeps showing results filtered by the old
              // keywords/sources until the next reload.
              void loadVacancies();
            }}
            onCancel={() => setIsEditing(false)}
          />
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
                    {job.keywords ?? "-"}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-1.5">
                    <span className="text-muted-foreground">Sources: </span>
                    {job.sources.map((sourceId, index) => {
                      const source = sources?.find((s) => s.id === sourceId);
                      return (
                        <span key={sourceId}>
                          {source ? (
                            <a
                              href={source.baseUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={source.baseUrl}
                              className="text-link hover:underline"
                            >
                              {source.name}
                            </a>
                          ) : (
                            sourceId
                          )}
                          {index < job.sources.length - 1 && ","}
                        </span>
                      );
                    })}
                  </div>
                  <p>
                    <span className="text-muted-foreground">Last run: </span>
                    {job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : "Never"}
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
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
                        {job.status === "PENDING" ? "Start" : "Restart"}
                      </Button>
                    )}
                  </div>
                  {job.status !== "RUNNING" && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-fit"
                        onClick={() => setIsEditing(true)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        size="icon-sm"
                        aria-label="Delete crawler job"
                        title="Delete crawler job"
                        disabled={deletePendingId === jobId}
                        onClick={() => removeJob(jobId, job.name)}
                      >
                        🗑️
                      </Button>
                    </div>
                  )}
                </div>
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
                    {vacancies.map((vacancy) => {
                      const vacancyKey = `${vacancy.sourceId}:${vacancy.externalId}`;
                      const isRawExpanded = expandedRawVacancyIds.has(vacancyKey);
                      return (
                      <div
                        key={vacancyKey}
                        className="rounded-lg border border-border p-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <a
                            href={vacancy.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-link hover:underline"
                          >
                            {vacancy.title}
                          </a>
                          {vacancy.isRemote && (
                            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                              Remote
                            </span>
                          )}
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-1.5 w-fit"
                          title={`http://localhost:9200/crawler_results/_doc/${vacancyKey}`}
                          onClick={() => toggleRawVacancy(vacancyKey)}
                        >
                          {isRawExpanded ? "Hide raw ES data" : "View raw ES data"}
                        </Button>
                        {isRawExpanded && (
                          <pre className="mt-1.5 overflow-x-auto rounded-lg border border-border bg-muted p-2 text-xs text-foreground">
                            {JSON.stringify(vacancy, null, 2)}
                          </pre>
                        )}
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {vacancy.company ?? "Unknown company"}
                          {vacancy.location && ` - ${vacancy.location}`}
                          {vacancy.postedAt &&
                            ` - posted ${new Date(vacancy.postedAt).toLocaleDateString()}`}
                        </p>
                        {vacancy.skillsSummary && (
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {vacancy.skillsSummary}
                          </p>
                        )}
                        {vacancy.description && (
                          <p className="mt-1.5 line-clamp-2 text-xs text-foreground">
                            {vacancy.description}
                          </p>
                        )}
                      </div>
                      );
                    })}
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
