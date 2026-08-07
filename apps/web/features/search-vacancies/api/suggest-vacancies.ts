import { getJson } from "@/shared/lib/api";
import type { VacancySuggestion } from "../lib/vacancy-search-types";

interface VacancySuggestResponse {
  suggestions: VacancySuggestion[];
}

export async function suggestVacancies(
  prefix: string,
  token: string,
  signal?: AbortSignal,
): Promise<VacancySuggestResponse> {
  const qs = new URLSearchParams({ q: prefix }).toString();
  return getJson<VacancySuggestResponse>(`/vacancies/suggest?${qs}`, token, signal);
}
