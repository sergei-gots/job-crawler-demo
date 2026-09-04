import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CrawlSource } from "@prisma/client";
import { parseWeWorkRemotelyListing, parseWeWorkRemotelyRssFeed } from "./weWorkRemotelyStrategy.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf-8");
}

const source = {
  id: 3,
  baseUrl: "https://weworkremotely.com",
} as CrawlSource;

describe("parseWeWorkRemotelyListing", () => {
  it("parses valid listing rows and skips a promoted/ad row with no vacancy link", () => {
    const html = fixture("weWorkRemotelyListing.html");

    const vacancies = parseWeWorkRemotelyListing(html, source);

    expect(vacancies).toEqual([
      {
        externalId: "samsara-staff-software-engineer",
        title: "Staff Software Engineer",
        company: "Samsara",
        url: "https://weworkremotely.com/remote-jobs/samsara-staff-software-engineer",
        postedAt: null,
        sourceId: 3,
      },
      {
        externalId: "toptal-power-platform-solutions-architect",
        title: "Power Platform Solutions Architect",
        company: "Toptal",
        url: "https://weworkremotely.com/remote-jobs/toptal-power-platform-solutions-architect",
        postedAt: null,
        sourceId: 3,
      },
    ]);
  });
});

describe("parseWeWorkRemotelyRssFeed", () => {
  it("keys entries by the /remote-jobs/<slug> parsed from <link>, and extracts description/location/isRemote/postedAt/skillsSummary", () => {
    const xml = fixture("weWorkRemotelyRssFeed.xml");

    const bySlug = parseWeWorkRemotelyRssFeed(xml);

    expect([...bySlug.keys()]).toEqual([
      "samsara-staff-software-engineer",
      "fin-senior-solutions-engineer-latam",
    ]);

    const samsara = bySlug.get("samsara-staff-software-engineer");
    expect(samsara?.isRemote).toBe(true);
    expect(samsara?.location).toBe("Anywhere in the World");
    expect(samsara?.skillsSummary).toBe("Go, Python, TypeScript");
    expect(samsara?.postedAt).toBe(new Date("Mon, 17 Aug 2026 13:57:14 +0000").toISOString());
    expect(samsara?.description).toBe(
      "About the role:\nWe are hiring a Staff Software Engineer to join our platform team.",
    );
  });

  it("omits skillsSummary entirely (not an empty string) when the <skills> tag is empty", () => {
    const xml = fixture("weWorkRemotelyRssFeed.xml");

    const bySlug = parseWeWorkRemotelyRssFeed(xml);

    const fin = bySlug.get("fin-senior-solutions-engineer-latam");
    expect(fin).not.toHaveProperty("skillsSummary");
    expect(fin?.location).toBe("USA Only");
  });
});
