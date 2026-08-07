"use client";

import { useCallback, useEffect, useState } from "react";
import type { Vacancy } from "@/entities/vacancy";
import { ApiError } from "@/shared/lib/api";
import { searchVacancies } from "../api/search-vacancies";
import type { VacancySearchFacets } from "./vacancy-search-types";

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 10;

const EMPTY_FACETS: VacancySearchFacets = {
  specialization: [],
  seniority: [],
  isRemote: [],
  location: [],
  company: [],
};

interface UseVacancySearchOptions {
  token: string | null;
  handleUnauthorized: () => void;
}

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * Owns the Search page's query/facet-selection state and re-queries `GET /vacancies/search` on
 * any change. Free-text typing is debounced; facet toggles share the same debounce for
 * simplicity (a checkbox click is infrequent enough that 300ms is imperceptible).
 */
export function useVacancySearch({ token, handleUnauthorized }: UseVacancySearchOptions) {
  const [query, setQuery] = useState("");
  const [specialization, setSpecialization] = useState<Set<string>>(new Set());
  const [seniority, setSeniority] = useState<Set<string>>(new Set());
  // "true"/"false" rather than a real boolean Set, since these are the two independent
  // "Remote"/"On-site" checkboxes, not one tri-state control.
  const [remote, setRemote] = useState<Set<"true" | "false">>(new Set());
  const [location, setLocation] = useState<Set<string>>(new Set());
  const [company, setCompany] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [hits, setHits] = useState<Vacancy[] | null>(null);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<VacancySearchFacets>(EMPTY_FACETS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(
    async (signal: AbortSignal) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const result = await searchVacancies(
          {
            q: query.trim() || undefined,
            specialization: specialization.size ? [...specialization] : undefined,
            seniority: seniority.size ? [...seniority] : undefined,
            isRemote: remote.size ? [...remote].map((value) => value === "true") : undefined,
            location: location.size ? [...location] : undefined,
            company: company.size ? [...company] : undefined,
            page,
            pageSize: PAGE_SIZE,
          },
          token,
          signal,
        );
        setHits(result.hits);
        setTotal(result.total);
        setFacets(result.facets);
      } catch (err) {
        // A superseded request was aborted (newer query in flight) — drop it silently rather than
        // clobbering the newer request's state or surfacing a spurious error.
        if (signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) {
          handleUnauthorized();
          return;
        }
        setError(err instanceof ApiError ? err.message : "Failed to search vacancies");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [token, query, specialization, seniority, remote, location, company, page, handleUnauthorized],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => void runSearch(controller.signal), DEBOUNCE_MS);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [runSearch]);

  // Any query or facet change should jump back to page 1 — otherwise a narrowed result set can
  // strand us on a now-out-of-range page. Done with React's adjust-state-during-render pattern
  // (not an effect) so the reset happens before the debounced fetch settles: the request that
  // actually fires already carries page 1, and there's no extra render/fetch at a stale page.
  const filtersKey = `${query}|${[...specialization].sort()}|${[...seniority].sort()}|${[...remote].sort()}|${[...location].sort()}|${[...company].sort()}`;
  const [lastFiltersKey, setLastFiltersKey] = useState(filtersKey);
  if (filtersKey !== lastFiltersKey) {
    setLastFiltersKey(filtersKey);
    if (page !== 1) setPage(1);
  }

  return {
    query,
    setQuery,
    specialization,
    toggleSpecialization: (value: string) =>
      setSpecialization((prev) => toggleInSet(prev, value)),
    seniority,
    toggleSeniority: (value: string) => setSeniority((prev) => toggleInSet(prev, value)),
    remote,
    toggleRemote: (value: "true" | "false") => setRemote((prev) => toggleInSet(prev, value)),
    location,
    toggleLocation: (value: string) => setLocation((prev) => toggleInSet(prev, value)),
    company,
    toggleCompany: (value: string) => setCompany((prev) => toggleInSet(prev, value)),
    page,
    setPage,
    pageSize: PAGE_SIZE,
    hits,
    total,
    facets,
    loading,
    error,
  };
}
