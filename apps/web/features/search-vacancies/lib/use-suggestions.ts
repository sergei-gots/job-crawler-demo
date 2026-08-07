"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/shared/lib/api";
import { suggestVacancies } from "../api/suggest-vacancies";
import type { VacancySuggestion } from "./vacancy-search-types";

// Shorter than useVacancySearch's 300ms — suggestions are a lighter aggregation-only query and
// the dropdown should feel responsive while typing.
const DEBOUNCE_MS = 150;
const MIN_PREFIX_LENGTH = 2;

interface UseSuggestionsOptions {
  token: string | null;
  handleUnauthorized: () => void;
}

/**
 * Fetches distinct title/company autocomplete suggestions for the Search page's free-text box
 * (Increment 3c). Mirrors useVacancySearch's debounce + AbortController pattern so a superseded
 * keystroke's response can never overwrite a newer one's suggestions.
 */
export function useSuggestions(prefix: string, { token, handleUnauthorized }: UseSuggestionsOptions) {
  const [suggestions, setSuggestions] = useState<VacancySuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  const runSuggest = useCallback(
    async (signal: AbortSignal) => {
      if (!token || prefix.trim().length < MIN_PREFIX_LENGTH) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      try {
        const result = await suggestVacancies(prefix, token, signal);
        setSuggestions(result.suggestions);
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) {
          handleUnauthorized();
          return;
        }
        // Suggestions are a non-critical aid to typing — fail quietly rather than surface an
        // error banner for a dropdown the user may not even have opened.
        setSuggestions([]);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [token, prefix, handleUnauthorized],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => void runSuggest(controller.signal), DEBOUNCE_MS);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [runSuggest]);

  return { suggestions, loading };
}
