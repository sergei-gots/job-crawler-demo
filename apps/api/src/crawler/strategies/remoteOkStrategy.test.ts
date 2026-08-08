import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CrawlSource } from "@prisma/client";
import { parseListingPage } from "./remoteOkStrategy.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf-8");
}

const source = {
  id: 1,
  baseUrl: "https://remoteok.com",
} as CrawlSource;

describe("parseListingPage", () => {
  it("parses DOM attributes, dedupes tags, and skips a row missing data-id", () => {
    const html = fixture("remoteOkListing.html");

    const vacancies = parseListingPage(html, source);

    expect(vacancies).toHaveLength(3);
    expect(vacancies.map((v) => v.externalId)).toEqual(["111", "222", "333"]);
  });

  it("resolves the URL, converts the epoch to ISO, and hardcodes isRemote true", () => {
    const html = fixture("remoteOkListing.html");

    const [first] = parseListingPage(html, source);

    expect(first).toMatchObject({
      externalId: "111",
      title: "Senior Backend Engineer",
      company: "Acme Remote",
      url: "https://remoteok.com/remote-jobs/foo-111",
      postedAt: "2023-11-14T22:13:20.000Z",
      sourceId: 1,
      isRemote: true,
      skillsSummary: "React, Node",
    });
  });

  it("flattens description HTML to plain text when the row's JSON-LD parses", () => {
    const html = fixture("remoteOkListing.html");

    const [first] = parseListingPage(html, source);

    expect(first.description).toBe("Great backend role.");
  });

  it("falls back to description: null (not a thrown error) when the row's JSON-LD is malformed", () => {
    const html = fixture("remoteOkListing.html");

    const vacancies = parseListingPage(html, source);
    const malformedRow = vacancies.find((v) => v.externalId === "222");

    expect(malformedRow?.description).toBeNull();
  });

  it("dedupes tags that render twice in the DOM (desktop + mobile layout variants)", () => {
    const html = fixture("remoteOkListing.html");

    const vacancies = parseListingPage(html, source);
    const dedupedRow = vacancies.find((v) => v.externalId === "333");

    expect(dedupedRow?.skillsSummary).toBe("React, Vue");
    expect(dedupedRow?.description).toBeNull();
  });
});
