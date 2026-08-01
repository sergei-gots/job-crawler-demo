import { searchVacancies, type VacancySearchFilters, type VacancySearchResult } from "../search/queryVacancies.js";

export async function searchAllVacancies(filters: VacancySearchFilters): Promise<VacancySearchResult> {
  return searchVacancies(filters);
}
