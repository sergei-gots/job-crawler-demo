import { beforeEach, describe, expect, it, vi } from "vitest";

const searchMock = vi.fn();

vi.mock("./esClient.js", () => ({
  esClient: { search: (...args: unknown[]) => searchMock(...args) },
}));

vi.mock("./crawlerResultsIndex.js", () => ({
  CRAWLER_RESULTS_INDEX: "crawler_results",
  ensureCrawlerResultsIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./queryVacancies.js", () => ({
  staleCutoffIso: () => "2026-01-01T00:00:00.000Z",
}));

const { suggestVacancies } = await import("./suggestVacancies.js");

function esResponse(overrides: {
  title?: { key: string; doc_count: number; original: string }[];
  company?: { key: string; doc_count: number; original: string }[];
}) {
  function buckets(entries: { key: string; doc_count: number; original: string }[] = []) {
    return entries.map((e) => ({
      key: e.key,
      doc_count: e.doc_count,
      original: { hits: { hits: [{ _source: { title: e.original, company: e.original } }] } },
    }));
  }
  return {
    hits: { hits: [] },
    aggregations: {
      title: { buckets: buckets(overrides.title) },
      company: { buckets: buckets(overrides.company) },
    },
  };
}

describe("suggestVacancies", () => {
  beforeEach(() => {
    searchMock.mockReset();
  });

  it("returns [] and skips the ES call for a prefix shorter than 2 characters", async () => {
    const result = await suggestVacancies("j");

    expect(result).toEqual([]);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("returns [] for an empty/whitespace-only prefix", async () => {
    const result = await suggestVacancies("  ");

    expect(result).toEqual([]);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("builds an age-filtered query with lowercased prefix-include terms aggregations on the .suggest sub-fields", async () => {
    searchMock.mockResolvedValue(esResponse({}));

    await suggestVacancies("Je");

    expect(searchMock).toHaveBeenCalledTimes(1);
    const request = searchMock.mock.calls[0][0];

    expect(request.size).toBe(0);
    expect(request.query.bool.filter).toEqual([
      { range: { lastSeenAt: { gte: "2026-01-01T00:00:00.000Z" } } },
    ]);
    expect(request.aggregations.title.terms).toEqual({
      field: "title.suggest",
      include: "je.*",
      size: 5,
    });
    expect(request.aggregations.company.terms).toEqual({
      field: "company.suggest",
      include: "je.*",
      size: 5,
    });
    expect(request.aggregations.title.aggregations.original.top_hits).toEqual({
      size: 1,
      _source: ["title"],
    });
    expect(request.aggregations.company.aggregations.original.top_hits).toEqual({
      size: 1,
      _source: ["company"],
    });
  });

  it("escapes regex metacharacters in the prefix before building the include pattern", async () => {
    searchMock.mockResolvedValue(esResponse({}));

    await suggestVacancies("C++");

    const request = searchMock.mock.calls[0][0];
    expect(request.aggregations.title.terms.include).toBe("c\\+\\+.*");
  });

  it("maps buckets to deduped, original-case suggestions tagged by field", async () => {
    searchMock.mockResolvedValue(
      esResponse({
        company: [
          { key: "jetbrains", doc_count: 3, original: "JetBrains" },
          { key: "jetbrains", doc_count: 3, original: "JetBrains" },
        ],
        title: [{ key: "java developer", doc_count: 2, original: "Java Developer" }],
      }),
    );

    const result = await suggestVacancies("Je");

    expect(result).toEqual([
      { value: "Java Developer", field: "title" },
      { value: "JetBrains", field: "company" },
    ]);
  });

  it("falls back to the lowercased bucket key when top_hits has no source", async () => {
    searchMock.mockResolvedValue({
      hits: { hits: [] },
      aggregations: {
        title: { buckets: [] },
        company: { buckets: [{ key: "jetbrains", doc_count: 1, original: { hits: { hits: [] } } }] },
      },
    });

    const result = await suggestVacancies("je");

    expect(result).toEqual([{ value: "jetbrains", field: "company" }]);
  });
});
