import { describe, expect, it } from "vitest";
import type { CrawlSource } from "@prisma/client";
import { getStrategy } from "./index.js";
import { habrCareerStrategy } from "./strategies/habrCareerStrategy.js";
import { remoteOkStrategy } from "./strategies/remoteOkStrategy.js";

function sourceNamed(name: string): CrawlSource {
  return { name } as CrawlSource;
}

describe("getStrategy", () => {
  it("returns the habr_career strategy for \"Habr Career\"", () => {
    expect(getStrategy(sourceNamed("Habr Career"))).toBe(habrCareerStrategy);
  });

  it("returns the RemoteOK strategy for \"RemoteOK\"", () => {
    expect(getStrategy(sourceNamed("RemoteOK"))).toBe(remoteOkStrategy);
  });

  it("returns null for a source with no implemented strategy", () => {
    expect(getStrategy(sourceNamed("WeWorkRemotely"))).toBeNull();
    expect(getStrategy(sourceNamed("Craigslist"))).toBeNull();
  });
});
