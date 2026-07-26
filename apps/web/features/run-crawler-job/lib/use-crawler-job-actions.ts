"use client";

import { useCallback, useState } from "react";
import type { CrawlerJob } from "@/entities/crawler-job";
import { ApiError } from "@/shared/lib/api";
import { startCrawlerJob } from "../api/start-crawler-job";
import { stopCrawlerJob } from "../api/stop-crawler-job";

interface UseCrawlerJobActionsOptions {
  token: string | null;
  handleUnauthorized: () => void;
  onStarted?: (job: CrawlerJob) => void;
  onStopped?: (job: CrawlerJob) => void;
}

type CrawlerJobAction = (id: number, token: string) => Promise<CrawlerJob>;

/**
 * Shared start/stop logic for the Crawler Jobs list and Crawler Job Details pages: pending
 * state, 401 handling, and passing the already-returned job to the caller instead of forcing
 * a full refetch.
 */
export function useCrawlerJobActions({
  token,
  handleUnauthorized,
  onStarted,
  onStopped,
}: UseCrawlerJobActionsOptions) {
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAction = useCallback(
    async (
      id: number,
      action: CrawlerJobAction,
      onSuccess: ((job: CrawlerJob) => void) | undefined,
      fallbackMessage: string,
    ) => {
      if (!token) return;
      setError(null);
      setPendingId(id);
      try {
        const job = await action(id, token);
        onSuccess?.(job);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          handleUnauthorized();
          return;
        }
        setError(err instanceof ApiError ? err.message : fallbackMessage);
      } finally {
        setPendingId(null);
      }
    },
    [token, handleUnauthorized],
  );

  const start = useCallback(
    (id: number) => runAction(id, startCrawlerJob, onStarted, "Failed to start crawler job"),
    [runAction, onStarted],
  );
  const stop = useCallback(
    (id: number) => runAction(id, stopCrawlerJob, onStopped, "Failed to stop crawler job"),
    [runAction, onStopped],
  );

  return { start, stop, pendingId, error };
}
