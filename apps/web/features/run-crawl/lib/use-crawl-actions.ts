"use client";

import { useCallback, useState } from "react";
import type { CrawlRun } from "@/entities/source";
import { ApiError } from "@/shared/lib/api";
import { startCrawl } from "../api/start-crawl";
import { stopCrawl } from "../api/stop-crawl";
import { startListingCrawl } from "../api/start-listing-crawl";
import { stopListingCrawl } from "../api/stop-listing-crawl";

// A crawl target: either a whole source, or one of its CrawlListing sub-targets (see
// .claude/features/09_FEATURE_CRAWL_LISTINGS.md). Discriminated so the hook can dispatch to the
// right endpoint and callers can compare "is this specific row pending" without ambiguity between
// a source id and a listing id sharing the same numeric space.
export type CrawlSlotKey =
  | { kind: "source"; sourceId: number }
  | { kind: "listing"; sourceId: number; listingId: number };

export function sourceSlot(sourceId: number): CrawlSlotKey {
  return { kind: "source", sourceId };
}

export function listingSlot(sourceId: number, listingId: number): CrawlSlotKey {
  return { kind: "listing", sourceId, listingId };
}

function slotKeyString(key: CrawlSlotKey): string {
  return key.kind === "source" ? `source:${key.sourceId}` : `listing:${key.sourceId}:${key.listingId}`;
}

interface UseCrawlActionsOptions {
  token: string | null;
  handleUnauthorized: () => void;
  onStarted?: (run: CrawlRun) => void;
  onStopped?: (run: CrawlRun) => void;
}

type CrawlAction = (key: CrawlSlotKey, token: string) => Promise<CrawlRun>;

async function startForKey(key: CrawlSlotKey, token: string): Promise<CrawlRun> {
  return key.kind === "source"
    ? startCrawl(key.sourceId, token)
    : startListingCrawl(key.sourceId, key.listingId, token);
}

async function stopForKey(key: CrawlSlotKey, token: string): Promise<CrawlRun> {
  return key.kind === "source"
    ? stopCrawl(key.sourceId, token)
    : stopListingCrawl(key.sourceId, key.listingId, token);
}

/**
 * Shared start/stop logic for the Sources list, Source detail, and Listing detail pages: pending
 * state, 401 handling, and passing the already-returned run to the caller instead of forcing a
 * refetch.
 */
export function useCrawlActions({
  token,
  handleUnauthorized,
  onStarted,
  onStopped,
}: UseCrawlActionsOptions) {
  const [pendingKey, setPendingKey] = useState<CrawlSlotKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAction = useCallback(
    async (
      key: CrawlSlotKey,
      action: CrawlAction,
      onSuccess: ((run: CrawlRun) => void) | undefined,
      fallbackMessage: string,
    ) => {
      if (!token) return;
      setError(null);
      setPendingKey(key);
      try {
        const run = await action(key, token);
        onSuccess?.(run);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          handleUnauthorized();
          return;
        }
        setError(err instanceof ApiError ? err.message : fallbackMessage);
      } finally {
        setPendingKey(null);
      }
    },
    [token, handleUnauthorized],
  );

  const start = useCallback(
    (key: CrawlSlotKey) => runAction(key, startForKey, onStarted, "Failed to start crawl"),
    [runAction, onStarted],
  );
  const stop = useCallback(
    (key: CrawlSlotKey) => runAction(key, stopForKey, onStopped, "Failed to stop crawl"),
    [runAction, onStopped],
  );
  const isPending = useCallback(
    (key: CrawlSlotKey) => pendingKey !== null && slotKeyString(pendingKey) === slotKeyString(key),
    [pendingKey],
  );

  return { start, stop, pendingKey, isPending, error };
}
