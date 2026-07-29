import { getJson } from "@/shared/lib/api";
import type { Vacancy } from "@/entities/vacancy";

export async function getSourceVacancies(id: number, token: string): Promise<Vacancy[]> {
  const res = await getJson<{ vacancies: Vacancy[] }>(`/sources/${id}/vacancies`, token);
  return res.vacancies;
}
