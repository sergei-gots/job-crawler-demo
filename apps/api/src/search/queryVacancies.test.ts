import { beforeEach, describe, expect, it, vi } from "vitest";

const searchMock = vi.fn();

vi.mock("./esClient.js", () => ({
  esClient: { search: (...args: unknown[]) => searchMock(...args) },
}));

vi.mock("./crawlerResultsIndex.js", () => ({
  CRAWLER_RESULTS_INDEX: "crawler_results",
  ensureCrawlerResultsIndex: vi.fn().mockResolvedValue(undefined),
}));

const { searchVacancies } = await import("./queryVacancies.js");

function esResponse(): unknown {
  return {
    hits: { hits: [], total: { value: 0 } },
    aggregations: {
      specialization: { buckets: [] },
      seniority: { buckets: [] },
      isRemote: { buckets: [] },
      location: { buckets: [] },
      company: { buckets: [] },
    },
  };
}

describe("searchVacancies", () => {
  beforeEach(() => {
    searchMock.mockReset();
    searchMock.mockResolvedValue(esResponse());
  });

  it("applies no isRemote filter when neither Remote nor On-site is selected", async () => {
    await searchVacancies({});

    const request = searchMock.mock.calls[0][0];
    expect(request.query.bool.filter).not.toContainEqual(
      expect.objectContaining({ terms: expect.objectContaining({ isRemote: expect.anything() }) }),
    );
  });

  it("filters to only remote vacancies when exactly one value (true) is selected", async () => {
    await searchVacancies({ isRemote: [true] });

    const request = searchMock.mock.calls[0][0];
    expect(request.query.bool.filter).toContainEqual({ terms: { isRemote: [true] } });
  });

  it("applies no isRemote filter when both Remote and On-site are selected - this must include vacancies that never set isRemote at all (e.g. every Craigslist vacancy), not just true/false ones", async () => {
    await searchVacancies({ isRemote: [true, false] });

    const request = searchMock.mock.calls[0][0];
    expect(request.query.bool.filter).not.toContainEqual(
      expect.objectContaining({ terms: expect.objectContaining({ isRemote: expect.anything() }) }),
    );
  });

  it("uses a higher facet aggregation size for company/location than for the low-cardinality enum facets", async () => {
    await searchVacancies({});

    const request = searchMock.mock.calls[0][0];
    expect(request.aggregations.specialization.terms.size).toBe(20);
    expect(request.aggregations.seniority.terms.size).toBe(20);
    expect(request.aggregations.isRemote.terms.size).toBe(20);
    expect(request.aggregations.location.terms.size).toBe(100);
    expect(request.aggregations.company.terms.size).toBe(100);
  });
});
