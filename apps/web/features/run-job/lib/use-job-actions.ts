"use client";

import { useCallback, useState } from "react";
import type { Job } from "@/entities/job";
import { ApiError } from "@/shared/lib/api";
import { startJob } from "../api/start-job";
import { stopJob } from "../api/stop-job";

interface UseJobActionsOptions {
  token: string | null;
  handleUnauthorized: () => void;
  onStarted?: (job: Job) => void;
  onStopped?: (job: Job) => void;
}

type JobAction = (id: number, token: string) => Promise<Job>;

/**
 * Shared start/stop logic for the Jobs list and Job Details pages: pending state, 401 handling,
 * and passing the already-returned Job to the caller instead of forcing a full refetch.
 */
export function useJobActions({ token, handleUnauthorized, onStarted, onStopped }: UseJobActionsOptions) {
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAction = useCallback(
    async (id: number, action: JobAction, onSuccess: ((job: Job) => void) | undefined, fallbackMessage: string) => {
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
    (id: number) => runAction(id, startJob, onStarted, "Failed to start job"),
    [runAction, onStarted],
  );
  const stop = useCallback(
    (id: number) => runAction(id, stopJob, onStopped, "Failed to stop job"),
    [runAction, onStopped],
  );

  return { start, stop, pendingId, error };
}
