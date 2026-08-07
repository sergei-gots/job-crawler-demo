import { searchVacancies, type VacancySearchFilters, type VacancySearchResult } from "../search/queryVacancies.js";
import { suggestVacancies, type VacancySuggestion } from "../search/suggestVacancies.js";

export async function searchAllVacancies(filters: VacancySearchFilters): Promise<VacancySearchResult> {
  return searchVacancies(filters);
}

export async function suggestAllVacancies(prefix: string): Promise<VacancySuggestion[]> {
  return suggestVacancies(prefix);
}
