"use client";

import { useCallback, useEffect, useState } from "react";
import type { Vacancy } from "@/entities/vacancy";
import { ApiError } from "@/shared/lib/api";
import { searchVacancies } from "../api/search-vacancies";
import type { VacancySearchFacets } from "./vacancy-search-types";

const DEBOUNCE_MS = 300;

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
  const [hits, setHits] = useState<Vacancy[] | null>(null);
  const [facets, setFacets] = useState<VacancySearchFacets>(EMPTY_FACETS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
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
        },
        token,
      );
      setHits(result.hits);
      setFacets(result.facets);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized();
        return;
      }
      setError(err instanceof ApiError ? err.message : "Failed to search vacancies");
    } finally {
      setLoading(false);
    }
  }, [token, query, specialization, seniority, remote, location, company, handleUnauthorized]);

  useEffect(() => {
    const timeout = setTimeout(() => void runSearch(), DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [runSearch]);

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
    hits,
    facets,
    loading,
    error,
  };
}
