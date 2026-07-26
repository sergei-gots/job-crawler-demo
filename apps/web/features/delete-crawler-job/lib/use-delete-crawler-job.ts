"use client";

import { useCallback, useState } from "react";
import { ApiError } from "@/shared/lib/api";
import { deleteJob } from "../api/delete-job";

interface UseDeleteCrawlerJobOptions {
  token: string | null;
  handleUnauthorized: () => void;
  onDeleted: (id: number) => void;
}

export function useDeleteCrawlerJob({ token, handleUnauthorized, onDeleted }: UseDeleteCrawlerJobOptions) {
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = useCallback(
    async (id: number, jobName: string) => {
      if (!token) return;
      if (!window.confirm(`Delete crawler job "${jobName}"? This cannot be undone.`)) return;

      setError(null);
      setPendingId(id);
      try {
        await deleteJob(id, token);
        onDeleted(id);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          handleUnauthorized();
          return;
        }
        setError(err instanceof ApiError ? err.message : "Failed to delete crawler job");
      } finally {
        setPendingId(null);
      }
    },
    [token, handleUnauthorized, onDeleted],
  );

  return { remove, pendingId, error };
}
