import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMock = vi.fn();

vi.mock("./esClient.js", () => ({
  esClient: { update: (...args: unknown[]) => updateMock(...args) },
}));

vi.mock("./crawlerResultsIndex.js", () => ({
  CRAWLER_RESULTS_INDEX: "crawler_results",
  ensureCrawlerResultsIndex: vi.fn().mockResolvedValue(undefined),
}));

const { upsertVacancy } = await import("./upsertVacancy.js");

const baseVacancy = {
  externalId: "111",
  title: "Backend Developer",
  company: "Acme Corp",
  url: "https://example.com/jobs/111",
  postedAt: "2026-08-01T10:00:00.000Z",
  sourceId: 1,
};

describe("upsertVacancy", () => {
  beforeEach(() => {
    updateMock.mockReset();
  });

  it("upserts by sourceId:externalId against the crawler_results index", async () => {
    await upsertVacancy(baseVacancy);

    expect(updateMock).toHaveBeenCalledTimes(1);
    const request = updateMock.mock.calls[0][0];
    expect(request.index).toBe("crawler_results");
    expect(request.id).toBe("1:111");
  });

  it("omits detail fields entirely (not as null) when the raw vacancy doesn't carry them", async () => {
    await upsertVacancy(baseVacancy);

    const request = updateMock.mock.calls[0][0];
    for (const field of ["description", "location", "isRemote", "skillsSummary", "specialization", "seniority"]) {
      expect(request.doc).not.toHaveProperty(field);
      expect(request.upsert).not.toHaveProperty(field);
    }
  });

  it("writes an explicit null for a detail field the source genuinely has no value for, distinct from omitting it", async () => {
    await upsertVacancy({ ...baseVacancy, description: null, isRemote: false });

    const request = updateMock.mock.calls[0][0];
    expect(request.doc.description).toBeNull();
    expect(request.doc.isRemote).toBe(false);
    expect(request.doc).not.toHaveProperty("location");
  });

  it("includes present detail fields on both doc and upsert", async () => {
    await upsertVacancy({
      ...baseVacancy,
      description: "Great role",
      isRemote: true,
      skillsSummary: "React, Node",
    });

    const request = updateMock.mock.calls[0][0];
    expect(request.doc).toMatchObject({
      description: "Great role",
      isRemote: true,
      skillsSummary: "React, Node",
    });
    expect(request.upsert).toMatchObject({
      description: "Great role",
      isRemote: true,
      skillsSummary: "React, Node",
    });
  });

  it("sets firstSeenAt only on the upsert branch, and lastSeenAt on both", async () => {
    await upsertVacancy(baseVacancy);

    const request = updateMock.mock.calls[0][0];
    expect(request.doc).not.toHaveProperty("firstSeenAt");
    expect(typeof request.upsert.firstSeenAt).toBe("string");
    expect(typeof request.doc.lastSeenAt).toBe("string");
    expect(typeof request.upsert.lastSeenAt).toBe("string");
  });
});
