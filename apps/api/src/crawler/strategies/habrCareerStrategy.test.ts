import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CrawlSource } from "@prisma/client";
import { parseHabrCareerPage, parseHabrVacancyDetail } from "./habrCareerStrategy.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf-8");
}

const source = {
  id: 3,
  baseUrl: "https://career.habr.com",
} as CrawlSource;

describe("parseHabrCareerPage", () => {
  it("parses valid vacancy cards and skips a card missing a vacancy href/title", () => {
    const html = fixture("habrCareerListing.html");

    const vacancies = parseHabrCareerPage(html, source);

    expect(vacancies).toEqual([
      {
        externalId: "1000123456",
        title: "Backend Developer",
        company: "Acme Corp",
        url: "https://career.habr.com/vacancies/1000123456",
        postedAt: "2026-08-01T10:00:00+03:00",
        sourceId: 3,
      },
      {
        externalId: "1000789012",
        title: "Frontend Developer",
        company: "Beta LLC",
        url: "https://career.habr.com/vacancies/1000789012",
        postedAt: "2026-08-02T11:30:00+03:00",
        sourceId: 3,
      },
    ]);
  });
});

describe("parseHabrVacancyDetail", () => {
  it("extracts description/location/isRemote/seniority/specialization from the JobPosting JSON-LD block", () => {
    const html = fixture("habrCareerVacancyDetail.html");

    const details = parseHabrVacancyDetail(html);

    expect(details.isRemote).toBe(true);
    expect(details.location).toBe("Москва");
    expect(details.seniority).toBe("Middle");
    expect(details.specialization).toBe("Backend разработчик");
    expect(details.skillsSummary).toBe(
      "Навыки: TypeScript, React. Квалификация: Middle. Специализации: Backend разработчик.",
    );
    expect(details.description).toBe(
      "Навыки: TypeScript, React. Квалификация: Middle. Специализации: Backend разработчик.\nИщем опытного разработчика в команду.",
    );
  });

  it("throws when no JobPosting JSON-LD block is present, so the caller skips the upsert entirely", () => {
    const html = fixture("habrCareerVacancyDetailNoJobPosting.html");

    expect(() => parseHabrVacancyDetail(html)).toThrow(
      "no JobPosting JSON-LD block found on vacancy detail page",
    );
  });
});
