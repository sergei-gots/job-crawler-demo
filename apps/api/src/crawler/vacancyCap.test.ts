import { describe, expect, it } from "vitest";
import type { RawVacancy } from "./types.js";
import { applyVacancyCap } from "./vacancyCap.js";

function vacancy(externalId: string): RawVacancy {
  return {
    externalId,
    title: `Vacancy ${externalId}`,
    company: null,
    url: `https://example.com/${externalId}`,
    postedAt: null,
    sourceId: 1,
  };
}

describe("applyVacancyCap", () => {
  it("returns the list unchanged and truncated=false when under the cap", () => {
    const vacancies = [vacancy("1"), vacancy("2")];

    const result = applyVacancyCap(vacancies, 5);

    expect(result).toEqual({ vacancies, truncated: false });
  });

  it("truncates to exactly the cap and reports truncated=true when over it", () => {
    const vacancies = [vacancy("1"), vacancy("2"), vacancy("3")];

    const result = applyVacancyCap(vacancies, 2);

    expect(result.truncated).toBe(true);
    expect(result.vacancies).toEqual([vacancy("1"), vacancy("2")]);
  });

  it("returns the list unchanged when exactly at the cap", () => {
    const vacancies = [vacancy("1"), vacancy("2")];

    const result = applyVacancyCap(vacancies, 2);

    expect(result).toEqual({ vacancies, truncated: false });
  });
});
