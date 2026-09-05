import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CrawlSource } from "@prisma/client";
import { parseCraigslistListing, parseCraigslistVacancyDetail } from "./craigslistStrategy.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf-8");
}

const source = {
  id: 4,
  baseUrl: "https://www.craigslist.org",
} as CrawlSource;

describe("parseCraigslistListing", () => {
  it("parses valid rows and skips the hub-links row and a row missing its detail link", () => {
    const html = fixture("craigslistListing.html");

    const vacancies = parseCraigslistListing(html, source);

    expect(vacancies).toEqual([
      {
        externalId: "aBcDeFgHiJkLmNoPqRsT",
        title: "Senior Full Stack Engineer",
        company: null,
        url: "https://www.craigslist.org/view/d/san-francisco-senior-full-stack/aBcDeFgHiJkLmNoPqRsT",
        postedAt: null,
        sourceId: 4,
      },
      {
        externalId: "xYzWvUtSrQpOnMlKjIhG",
        title: "Backend Software Engineer",
        company: null,
        url: "https://www.craigslist.org/view/d/oakland-backend-software-engineer/xYzWvUtSrQpOnMlKjIhG",
        postedAt: null,
        sourceId: 4,
      },
    ]);
  });
});

describe("parseCraigslistVacancyDetail", () => {
  it("extracts company/postedAt/description/location/specialization from the JobPosting JSON-LD block, and leaves isRemote unset", () => {
    const html = fixture("craigslistVacancyDetail.html");

    const details = parseCraigslistVacancyDetail(html);

    expect(details.company).toBe("Acme Corp");
    expect(details.postedAt).toBe("2026-09-05T11:24:09+0000");
    expect(details.location).toBe("San Francisco, CA");
    expect(details.specialization).toBe("Full-Stack");
    expect(details.description).toBe(
      "We are looking for a Senior Full Stack Engineer.\n\nResponsibilities\n\nBuild things.",
    );
    expect(details.isRemote).toBeUndefined();
    expect(details).not.toHaveProperty("isRemote");
  });

  it("throws when no JobPosting JSON-LD block is present, so the caller skips the upsert entirely", () => {
    const html = fixture("craigslistVacancyDetailNoJobPosting.html");

    expect(() => parseCraigslistVacancyDetail(html)).toThrow(
      "no JobPosting JSON-LD block found on vacancy detail page",
    );
  });
});
