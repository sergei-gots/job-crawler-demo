"use client";

import { useCallback, useState } from "react";
import type { CrawlRun } from "@/entities/source";
import { ApiError } from "@/shared/lib/api";
import { startCrawl } from "../api/start-crawl";
import { stopCrawl } from "../api/stop-crawl";

interface UseCrawlActionsOptions {
  token: string | null;
  handleUnauthorized: () => void;
  onStarted?: (run: CrawlRun) => void;
  onStopped?: (run: CrawlRun) => void;
}

type CrawlAction = (id: number, token: string) => Promise<CrawlRun>;

/**
 * Shared start/stop logic for the Sources list and Source detail pages: pending state, 401
 * handling, and passing the already-returned run to the caller instead of forcing a refetch.
 */
export function useCrawlActions({
  token,
  handleUnauthorized,
  onStarted,
  onStopped,
}: UseCrawlActionsOptions) {
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAction = useCallback(
    async (
      id: number,
      action: CrawlAction,
      onSuccess: ((run: CrawlRun) => void) | undefined,
      fallbackMessage: string,
    ) => {
      if (!token) return;
      setError(null);
      setPendingId(id);
      try {
        const run = await action(id, token);
        onSuccess?.(run);
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
    (id: number) => runAction(id, startCrawl, onStarted, "Failed to start crawl"),
    [runAction, onStarted],
  );
  const stop = useCallback(
    (id: number) => runAction(id, stopCrawl, onStopped, "Failed to stop crawl"),
    [runAction, onStopped],
  );

  return { start, stop, pendingId, error };
}
