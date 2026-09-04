import { getJson } from "@/shared/lib/api";
import type { Vacancy } from "@/entities/vacancy";

export async function getListingVacancies(
  sourceId: number,
  listingId: number,
  token: string,
): Promise<Vacancy[]> {
  const res = await getJson<{ vacancies: Vacancy[] }>(
    `/sources/${sourceId}/listings/${listingId}/vacancies`,
    token,
  );
  return res.vacancies;
}
