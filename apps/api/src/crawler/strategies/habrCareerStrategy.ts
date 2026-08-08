import axios from "axios";
import * as cheerio from "cheerio";
import type { CrawlSource } from "@prisma/client";
import { getOrFetch } from "../pageCache.js";
import { htmlToText } from "../htmlToText.js";
import { waitForSlot } from "../rateLimiter.js";
import { upsertVacancy } from "../../search/upsertVacancy.js";
import type { CrawlResult, CrawlStrategy, EnrichDetailsResult, LogProgress, RawVacancy } from "../types.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Without an explicit timeout, axios/Node will wait indefinitely on a connection that opens but
// never responds — a hung request blocks the whole crawler job run rather than failing into the
// existing retry/error handling. 20s is comfortably above habr_career's normal response time.
const REQUEST_TIMEOUT_MS = 20_000;

function parseHabrCareerPage(html: string, source: CrawlSource): RawVacancy[] {
  const $ = cheerio.load(html);
  const vacancies: RawVacancy[] = [];

  $(".vacancy-card").each((_, card) => {
    const el = $(card);
    const href = el.find('a[href^="/vacancies/"]').first().attr("href");
    const externalId = href?.match(/\/vacancies\/(\d+)/)?.[1];
    const title = el.find(".vacancy-card__title-link").first().text().trim();
    if (!externalId || !title) return;

    const company = el.find(".vacancy-card__company a").first().text().trim() || null;
    const postedAt = el.find(".vacancy-card__date time.basic-date").first().attr("datetime") ?? null;

    vacancies.push({
      externalId,
      title,
      company,
      url: new URL(href, source.baseUrl).toString(),
      postedAt,
      sourceId: source.id,
    });
  });

  return vacancies;
}

interface HabrJobPosting {
  "@type"?: string;
  description?: string;
  jobLocation?: Array<{ address?: string }>;
  jobLocationType?: string;
}

/**
 * Finds the schema.org/JobPosting block among the page's JSON-LD script tags by checking
 * `@type`, rather than assuming the first ld+json block is always the vacancy (a page could
 * carry an Organization/BreadcrumbList block too, ahead of or instead of JobPosting).
 */
function findJobPosting($: ReturnType<typeof cheerio.load>): HabrJobPosting | null {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const raw = $(el).html();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as HabrJobPosting;
      if (parsed["@type"] === "JobPosting") return parsed;
    } catch {
      // Malformed JSON in an unrelated script block - keep looking, don't abort the whole parse.
    }
  }
  return null;
}

/**
 * Pulls a single labeled clause (e.g. `"Квалификация: Middle."`) out of habr's auto-generated
 * lead sentence. Matched independently per label rather than by splitting the whole sentence on
 * position, because the template's clauses ("Навыки:", "Квалификация:", "Специализации:") aren't
 * all always present — a positional split would misattribute text when one is missing.
 */
function extractLabeledClause(skillsSummary: string, label: string): string | null {
  const match = skillsSummary.match(new RegExp(`${label}:\\s*([^.]+)\\.`));
  return match ? match[1].trim() : null;
}

/**
 * Parses habr_career's vacancy detail page via its schema.org/JobPosting JSON-LD block —
 * confirmed present on every real vacancy page checked (8/8), and far more stable than scraping
 * the page's ad-hoc CSS classes since it's the same structured data habr exposes for Google Jobs
 * indexing. Salary is deliberately not extracted: a manual check of ~150 listing cards found
 * 100% show "salary not specified", with only a "similar specialists earn" market estimate
 * visible — not the employer's own figure, so it isn't stored as if it were.
 *
 * Throws when no JobPosting block is found at all - the caller must treat that as "couldn't
 * extract anything" and skip the upsert entirely, never write it as "this vacancy has no
 * location/skills". Once a genuine JobPosting object is found, a field still missing from it
 * (e.g. no `jobLocation`) is real, current information from the source and is fine to return as
 * `null` - the two cases are deliberately not conflated.
 */
function parseHabrVacancyDetail(html: string): Partial<RawVacancy> {
  const $ = cheerio.load(html);
  const jobPosting = findJobPosting($);
  if (!jobPosting) throw new Error("no JobPosting JSON-LD block found on vacancy detail page");

  const descriptionHtml = jobPosting.description ?? "";
  const description = htmlToText(descriptionHtml);

  // Re-parsed separately from `description` (which is flattened to plain text) because the
  // labeled-clause extraction below needs to find the lead <p> specifically, not just any text.
  const withBreaks = descriptionHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|h[1-6])>/gi, "\n");
  const $description = cheerio.load(withBreaks);
  const leadParagraph = $description("p").first().text().trim();
  const skillsSummary = leadParagraph.startsWith("Навыки") ? leadParagraph : null;
  const seniority = skillsSummary ? extractLabeledClause(skillsSummary, "Квалификация") : null;
  const specialization = skillsSummary
    ? extractLabeledClause(skillsSummary, "Специализации")
    : null;

  return {
    description,
    location: jobPosting.jobLocation?.[0]?.address ?? null,
    isRemote: jobPosting.jobLocationType === "TELECOMMUTE",
    skillsSummary,
    seniority,
    specialization,
  };
}

/**
 * Handles habr_career's vacancy listing, confirmed server-rendered (no JS execution needed) via
 * a manual curl check — CrawlSource.type is seeded as STATIC accordingly. Selectors are specific
 * to habr_career's markup, not a generic HTML scraper.
 *
 * Named after the site, not the library (axios+cheerio) — a CrawlStrategy is 1:1 with a source
 * (dispatch in crawler/index.ts is by source.name), and the technology used to fetch/parse it is
 * an implementation detail. See remoteOkStrategy.ts for the Puppeteer-based counterpart.
 */
export const habrCareerStrategy: CrawlStrategy = {
  async crawl(source: CrawlSource): Promise<CrawlResult> {
    const vacancies: RawVacancy[] = [];
    const pageLogs: string[] = [];

    for (let page = 1; page <= source.maxPagesToCrawl; page += 1) {
      const pageUrl = new URL("/vacancies", source.baseUrl);
      if (page > 1) pageUrl.searchParams.set("page", String(page));

      const { html, cacheHit } = await getOrFetch(source.id, pageUrl.toString(), async () => {
        await waitForSlot(source.id, source.defaultDelayMs);
        const response = await axios.get<string>(pageUrl.toString(), {
          headers: { "User-Agent": USER_AGENT },
          timeout: REQUEST_TIMEOUT_MS,
        });
        return response.data;
      });

      const pageVacancies = parseHabrCareerPage(html, source);
      vacancies.push(...pageVacancies);
      pageLogs.push(
        `fetched page ${page} (cache: ${cacheHit ? "hit" : "miss"}, ${pageVacancies.length} vacancies)`,
      );
    }

    return { vacancies, pageLogs };
  },

  // No cap on how many vacancies get a detail fetch — every vacancy from the listing pass is
  // enriched, every run. The only volume bound is `source.maxPagesToCrawl` (already applied
  // above). This was a deliberate choice: an earlier draft capped detail fetches separately,
  // but that created a "ragged data" problem (the same first-N vacancies enriched forever while
  // the rest never were). Detail requests share the listing's own rate limiter/cache, so a full
  // run can take several minutes at habr_career's seeded 12s delay — accepted, since crawling
  // politeness takes priority over run speed for this project.
  async enrichDetails(
    source: CrawlSource,
    vacancies: RawVacancy[],
    isCancelled: () => boolean,
    logProgress: LogProgress,
  ): Promise<EnrichDetailsResult> {
    let enrichedCount = 0;
    const total = vacancies.length;
    const maxAttempts = 2; // one retry — transient network errors (e.g. ETIMEDOUT) shouldn't sacrifice a vacancy

    for (const [index, vacancy] of vacancies.entries()) {
      if (isCancelled()) break;

      // Fetching is retried (transient network errors are worth a second attempt); parsing is
      // not — a parse failure is deterministic for the same HTML, and getOrFetch would just
      // return the identical cached page on a retry, so retrying it can never succeed and would
      // only mislabel a real, persistent problem as "transient".
      let html: string | undefined;
      let cacheHit = false;
      let lastFetchError: unknown;

      for (let attempt = 1; attempt <= maxAttempts && html === undefined; attempt += 1) {
        if (isCancelled()) break;
        try {
          const result = await getOrFetch(source.id, vacancy.url, async () => {
            await waitForSlot(source.id, source.defaultDelayMs);
            const response = await axios.get<string>(vacancy.url, {
              headers: { "User-Agent": USER_AGENT },
              timeout: REQUEST_TIMEOUT_MS,
            });
            return response.data;
          });
          html = result.html;
          cacheHit = result.cacheHit;
        } catch (error) {
          lastFetchError = error;
          if (attempt < maxAttempts) {
            await logProgress(
              `attempt ${attempt}/${maxAttempts} failed to fetch vacancy ${index + 1}/${total} (${vacancy.externalId}), retrying: ${String(error)}`,
              "WARN",
            );
          }
        }
      }

      if (html === undefined) {
        await logProgress(
          `failed to fetch detail page for vacancy ${index + 1}/${total} (${vacancy.externalId}) after ${maxAttempts} attempts: ${String(lastFetchError)}`,
          "ERROR",
        );
        continue;
      }

      try {
        const details = parseHabrVacancyDetail(html);
        await upsertVacancy({ ...vacancy, ...details });
        enrichedCount += 1;
        await logProgress(
          `enriched vacancy ${index + 1}/${total} (cache: ${cacheHit ? "hit" : "miss"}): ${vacancy.title}`,
        );
      } catch (error) {
        await logProgress(
          `failed to parse detail page for vacancy ${index + 1}/${total} (${vacancy.externalId}): ${String(error)}`,
          "ERROR",
        );
      }
    }

    return { enrichedCount };
  },
};
