import { getJson } from "@/shared/lib/api";
import type { Vacancy } from "@/entities/vacancy";
import type { VacancySearchFacets, VacancySearchFilters } from "../lib/vacancy-search-types";

interface VacancySearchResponse {
  hits: Vacancy[];
  total: number;
  facets: VacancySearchFacets;
}

function buildQueryString(filters: VacancySearchFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  for (const value of filters.specialization ?? []) params.append("specialization", value);
  for (const value of filters.seniority ?? []) params.append("seniority", value);
  for (const value of filters.isRemote ?? []) params.append("isRemote", String(value));
  for (const value of filters.location ?? []) params.append("location", value);
  for (const value of filters.company ?? []) params.append("company", value);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  return params.toString();
}

export async function searchVacancies(
  filters: VacancySearchFilters,
  token: string,
  signal?: AbortSignal,
): Promise<VacancySearchResponse> {
  const qs = buildQueryString(filters);
  return getJson<VacancySearchResponse>(`/vacancies/search${qs ? `?${qs}` : ""}`, token, signal);
}
