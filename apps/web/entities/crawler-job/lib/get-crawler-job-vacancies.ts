import { getJson } from "@/shared/lib/api";
import type { Vacancy } from "./crawler-job-types";

export async function getCrawlerJobVacancies(id: number, token: string): Promise<Vacancy[]> {
  const res = await getJson<{ vacancies: Vacancy[] }>(`/crawler-jobs/${id}/vacancies`, token);
  return res.vacancies;
}
