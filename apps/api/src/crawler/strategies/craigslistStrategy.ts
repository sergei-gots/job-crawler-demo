import axios from "axios";
import * as cheerio from "cheerio";
import type { CrawlListing, CrawlSource } from "@prisma/client";
import { getOrFetch } from "../pageCache.js";
import { htmlToText } from "../htmlToText.js";
import { waitForSlot } from "../rateLimiter.js";
import { applyVacancyCap } from "../vacancyCap.js";
import { upsertVacancy } from "../../search/upsertVacancy.js";
import type { CrawlResult, CrawlStrategy, EnrichDetailsResult, LogProgress, RawVacancy } from "../types.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * The target listing URL, built from the CrawlListing's subPath (see .claude/features/
 * 09_FEATURE_CRAWL_LISTINGS.md and 10_FEATURE_CRAIGSLIST.md) - this strategy requires a listing,
 * same as weWorkRemotelyStrategy, since craigslist has no single global category URL: every real
 * target is a specific city's search page. subPath carries the full path+query
 * (`/search/area/<city>?cat=sof`), not just a path segment.
 */
function listingUrl(source: CrawlSource, listing: CrawlListing | null): string {
  if (!listing) {
    throw new Error("craigslistStrategy requires a CrawlListing - none was provided");
  }
  return new URL(listing.subPath, source.baseUrl).toString();
}

/**
 * Parses a city's job-search listing page. Row markup confirmed live (2026-09-05): each real
 * result is `li.cl-static-search-result` wrapping an `a[href^="https://www.craigslist.org/view/"]`
 * whose last URL segment is the listing's unique postToken (no numeric id is present anywhere on
 * the listing page, unlike habr). The page's very first `<li>` is a `cl-static-hub-links` "see
 * also" block (different class, no matching detail link) - naturally excluded by selecting
 * `li.cl-static-search-result` specifically, no separate filter needed.
 *
 * `div.price` (e.g. "$0") is a boilerplate placeholder on every listing checked and is
 * deliberately never read - same "don't store a placeholder as if it were real data" principle as
 * habr's dropped salary and RemoteOK's dropped baseSalary. `div.location` is also skipped here:
 * the detail page's JobPosting JSON-LD carries a more structured address, and reading "location"
 * from two different passes risks the two disagreeing.
 *
 * `company` and `postedAt` are only available on the detail page (see
 * parseCraigslistVacancyDetail) - unlike habr, where postedAt comes from the listing itself - so
 * both are explicitly null here and filled in by enrichDetails's patch.
 */
export function parseCraigslistListing(html: string, source: CrawlSource): RawVacancy[] {
  const $ = cheerio.load(html);
  const vacancies: RawVacancy[] = [];

  $("li.cl-static-search-result").each((_, el) => {
    const row = $(el);
    const href = row.find("a").first().attr("href");
    const externalId = href?.match(/\/view\/d\/[^/]+\/([^/?#]+)/)?.[1];
    const title = row.find("div.title").first().text().trim();
    if (!externalId || !href || !title) return;

    vacancies.push({
      externalId,
      title,
      company: null,
      url: new URL(href, source.baseUrl).toString(),
      postedAt: null,
      sourceId: source.id,
    });
  });

  return vacancies;
}

interface CraigslistJobPosting {
  "@type"?: string;
  title?: string;
  description?: string;
  hiringOrganization?: { name?: string };
  datePosted?: string;
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string } };
}

/**
 * Finds the schema.org/JobPosting block among the page's JSON-LD script tags by checking `@type`,
 * same approach as habrCareerStrategy.findJobPosting (robust to other ld+json blocks appearing on
 * the same page, rather than depending on the `id="ld_posting_data"` attribute observed live).
 */
function findJobPosting($: ReturnType<typeof cheerio.load>): CraigslistJobPosting | null {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const raw = $(el).html();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as CraigslistJobPosting;
      if (parsed["@type"] === "JobPosting") return parsed;
    } catch {
      // Malformed JSON in an unrelated script block - keep looking, don't abort the whole parse.
    }
  }
  return null;
}

/** Keyword match against the title only - craigslist's JobPosting JSON-LD has no dedicated
 * specialization/seniority field the way habr's labeled lead paragraph does, so this is a
 * best-effort classification, not a guaranteed one; unmatched titles are left null rather than
 * guessed. */
function guessSpecialization(title: string): string | null {
  const lower = title.toLowerCase();
  if (/full[\s-]?stack/.test(lower)) return "Full-Stack";
  if (/back[\s-]?end/.test(lower)) return "Backend";
  if (/front[\s-]?end/.test(lower)) return "Frontend";
  if (/mobile/.test(lower)) return "Mobile";
  return null;
}

/**
 * Parses craigslist's vacancy detail page via its schema.org/JobPosting JSON-LD block, confirmed
 * present on every real listing checked. `company` and `postedAt` only exist here, not on the
 * listing page (see parseCraigslistListing). No `jobLocationType`/TELECOMMUTE-style field exists
 * anywhere on this source - `isRemote` is deliberately left unset (not `null`, not `false`) rather
 * than guessed, same "missing information isn't false" principle as habrCareerStrategy.
 *
 * Throws when no JobPosting block is found at all - same contract and wording as
 * habrCareerStrategy's parseHabrVacancyDetail, so enrichDetails's catch/log path behaves
 * identically across strategies.
 */
export function parseCraigslistVacancyDetail(html: string): Partial<RawVacancy> {
  const $ = cheerio.load(html);
  const jobPosting = findJobPosting($);
  if (!jobPosting) throw new Error("no JobPosting JSON-LD block found on vacancy detail page");

  const address = jobPosting.jobLocation?.address;
  const location = [address?.addressLocality, address?.addressRegion].filter(Boolean).join(", ") || null;

  return {
    description: htmlToText(jobPosting.description ?? ""),
    location,
    company: jobPosting.hiringOrganization?.name ?? null,
    postedAt: jobPosting.datePosted ?? null,
    specialization: guessSpecialization(jobPosting.title ?? ""),
  };
}

/**
 * Axios + Cheerio strategy for craigslist: a listing pass (crawl) per seeded city CrawlListing,
 * followed by a per-vacancy detail-page enrichment pass - see .claude/features/
 * 10_FEATURE_CRAIGSLIST.md for the live spike findings behind every decision below.
 *
 * No Puppeteer needed anywhere: confirmed live (2026-09-05) that the listing and detail pages are
 * both plain server-rendered HTML with no Cloudflare challenge or CAPTCHA, and robots.txt doesn't
 * disallow /search/ or /view/.
 *
 * No real pagination exists on the listing page (no next-page link, no total-count element) - same
 * "one-shot fetch bounded by maxVacanciesToCrawl truncation" situation as weWorkRemotelyStrategy,
 * not habrCareerStrategy's page loop.
 */
export const craigslistStrategy: CrawlStrategy = {
  description:
    "Axios + Cheerio, two-pass (listing, then per-vacancy detail-page enrichment) — fully server-rendered, no browser needed, one listing fetch per seeded city",

  steps: [
    {
      type: "process",
      title: "Fetch listing - GET /search/area/<city>?cat=sof",
      detail: {
        method: "Axios - axios.get()",
        explanation: "Plain HTTP request, no browser needed.",
      },
    },
    {
      type: "decision",
      title: "Server-rendered, no bot wall?",
      detail: {
        explanation:
          "Confirmed via manual checks against the live site - no Cloudflare challenge, no CAPTCHA, and robots.txt doesn't disallow /search/ or /view/.",
        result: "Yes - no Puppeteer needed anywhere in this strategy.",
      },
    },
    {
      type: "process",
      title: "Parse listing rows",
      detail: {
        method: 'Cheerio - $("li.cl-static-search-result").each()',
        explanation:
          'Extracts externalId (the URL\'s postToken segment) and title from each result row; the site\'s own "see also" links row uses a different row class and is naturally excluded by this selector.',
      },
    },
    {
      type: "process",
      title: "Fetch each vacancy's detail page",
      detail: {
        method: "Axios - axios.get()",
        explanation: "Same rate limiter and 1h page cache as the listing fetch.",
      },
    },
    {
      type: "process",
      title: "Parse JobPosting JSON-LD",
      detail: {
        method: "Cheerio - JSON.parse(script.html())",
        explanation:
          "Extracts company, postedAt, description, and location from the detail page's schema.org/JobPosting block - company and postedAt are only available here, not on the listing page.",
      },
    },
  ],

  async crawl(source: CrawlSource, listing: CrawlListing | null): Promise<CrawlResult> {
    const pageUrl = listingUrl(source, listing);

    const { html, cacheHit } = await getOrFetch(source.id, pageUrl, async () => {
      await waitForSlot(source.id, source.defaultDelayMs);
      const response = await axios.get<string>(pageUrl, {
        headers: { "User-Agent": USER_AGENT },
        timeout: REQUEST_TIMEOUT_MS,
      });
      return response.data;
    });

    const parsed = parseCraigslistListing(html, source);
    const { vacancies, truncated } = applyVacancyCap(parsed, source.maxVacanciesToCrawl);
    const pageLogs = [`fetched listing (cache: ${cacheHit ? "hit" : "miss"}, ${parsed.length} vacancies)`];
    if (truncated) {
      pageLogs.push(`reached maxVacanciesToCrawl (${source.maxVacanciesToCrawl}) - truncated`);
    }

    return { vacancies, pageLogs };
  },

  // Per-vacancy fetch with retry, mirroring habrCareerStrategy's enrichDetails exactly (craigslist's
  // detail-fetch mechanism is identical to habr's: plain Axios, one page per vacancy) - unlike
  // weWorkRemotelyStrategy's single RSS-feed fetch, there's no one-shot bulk enrichment source here.
  async enrichDetails(
    source: CrawlSource,
    listing: CrawlListing | null,
    vacancies: RawVacancy[],
    isCancelled: () => boolean,
    logProgress: LogProgress,
  ): Promise<EnrichDetailsResult> {
    let enrichedCount = 0;
    const total = vacancies.length;
    const maxAttempts = 2; // one retry — transient network errors (e.g. ETIMEDOUT) shouldn't sacrifice a vacancy

    for (const [index, vacancy] of vacancies.entries()) {
      if (isCancelled()) break;

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
        const details = parseCraigslistVacancyDetail(html);
        await upsertVacancy({ ...vacancy, ...details }, listing?.id ?? null);
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
