import type { Vacancy } from "./vacancy-types";

/** The same deterministic id the backend upserts by (`sourceId:externalId`) — used as the React
 * list key and to build the raw-ES-doc lookup URL shown in the "View raw ES data" tooltip. */
export function vacancyKey(vacancy: Vacancy): string {
  return `${vacancy.sourceId}:${vacancy.externalId}`;
}
