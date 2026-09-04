import type { CrawlListing, CrawlSource } from "@prisma/client";

export interface RawVacancy {
  externalId: string;
  title: string;
  company: string | null;
  url: string;
  postedAt: string | null;
  sourceId: number;
  /** Detail-page fields below are only present once a source's enrichDetails has run. */
  description?: string | null;
  location?: string | null;
  isRemote?: boolean | null;
  skillsSummary?: string | null;
  specialization?: string | null;
  seniority?: string | null;
}

export interface CrawlResult {
  vacancies: RawVacancy[];
  /** One line per fetched page, e.g. "fetched page 1 (cache: miss, 25 vacancies)". */
  pageLogs: string[];
}

export interface EnrichDetailsResult {
  enrichedCount: number;
}

export type LogProgress = (message: string, level?: "INFO" | "WARN" | "ERROR") => Promise<void>;

export type StrategyStepType = "process" | "decision" | "problem" | "solution" | "terminal";

export interface StrategyStep {
  type: StrategyStepType;
  /** Always visible, short. */
  title: string;
  /**
   * Shown on click-to-expand in the UI. Rendered as a compact definition list (method /
   * explanation / result), not a prose paragraph — keep each field terse.
   */
  detail?: {
    /** The library method this step actually calls, if any — e.g. "Puppeteer — page.setUserAgent()". Omitted for steps with no library call (decisions, pure logic). */
    method?: string;
    /** What it does and why — the fact itself. */
    explanation: string;
    /** Measured outcome, when one exists — e.g. "120/120 listing fetches succeeded". */
    result?: string;
  };
}

export interface CrawlStrategy {
  /**
   * Short, human-readable summary of how this strategy actually fetches data (e.g. which
   * library/technique each phase uses), surfaced directly in the Source detail page UI in place
   * of a separate `CrawlSource.type` column. Living here means it can't drift from the code it
   * describes the way a DB-stored classification could (and did — see
   * `.claude/features/06_FEATURE_WEWORKREMOTELY_AND_VACANCY_CAP.md`'s "type field" decision):
   * changing the transport in `crawl()`/`enrichDetails()` and updating this string happen in the
   * same file, often the same edit.
   */
  description: string;
  /**
   * The step-by-step chain a reader would trace through this strategy's `crawl()`/
   * `enrichDetails()` — what was tried, what broke, what fixed it — surfaced in the UI as a
   * flowchart (see `.claude/features/07_FEATURE_STRATEGY_DIAGRAMS.md`). Lives here for the same
   * anti-drift reason as `description`: editing the transport/logic and updating `steps` happen
   * in the same file, often the same edit.
   */
  steps: StrategyStep[];
  /**
   * `listing` is the specific sub-target being crawled, for sources that have any (see
   * `.claude/features/09_FEATURE_CRAWL_LISTINGS.md`) — `null` for sources without listings,
   * which crawl exactly as before. Strategies that don't use listings (habr, RemoteOK) simply
   * ignore the parameter; `weWorkRemotelyStrategy` requires a non-null one.
   */
  crawl(source: CrawlSource, listing: CrawlListing | null): Promise<CrawlResult>;
  /**
   * Optional: fetches each vacancy's own detail page for richer fields (description, location,
   * etc.). Sources without a detail-crawl implementation simply omit this method. `logProgress`
   * is called once per vacancy (not batched) so `JobLog` shows live progress during what can be
   * a multi-minute, rate-limited loop.
   */
  enrichDetails?(
    source: CrawlSource,
    listing: CrawlListing | null,
    vacancies: RawVacancy[],
    isCancelled: () => boolean,
    logProgress: LogProgress,
  ): Promise<EnrichDetailsResult>;
}
