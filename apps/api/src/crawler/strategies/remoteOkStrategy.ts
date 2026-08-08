import puppeteer from "puppeteer";
import * as cheerio from "cheerio";
import type { CrawlSource } from "@prisma/client";
import { getOrFetch } from "../pageCache.js";
import { htmlToText } from "../htmlToText.js";
import { waitForSlot } from "../rateLimiter.js";
import type { CrawlResult, CrawlStrategy, RawVacancy } from "../types.js";

// A real desktop Chrome UA, not Puppeteer's default and not any bot-identifying string. RemoteOK
// 403s plain (non-browser) requests via a Cloudflare bot check — Puppeteer exists here to pass as
// a real browser, so presenting a truthful non-browser UA would defeat the point. Separately,
// robots.txt explicitly blocks `ClaudeBot`/etc. for general crawling (only re-allowing them for
// AI-reference/training use elsewhere in the file) — neither category applies to this app, which
// is building a job search index, not doing AI training/reference.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0 Safari/537.36";

const NAVIGATION_TIMEOUT_MS = 30_000;

/**
 * The listing path actually crawled. RemoteOK's `/remote-dev-jobs` category page renders ~50 job
 * rows per load; confirmed via a manual spike (2026-08) that `?page=2` returns the *same* 50 rows
 * (no query-string pagination on this endpoint) and that a "load more" flow only exists via an
 * AJAX endpoint (`?action=get_jobs`) that robots.txt explicitly disallows. So `crawl()` navigates
 * here exactly once per run regardless of `source.maxPagesToCrawl` — there is nothing further to
 * paginate into without violating robots.txt.
 */
const LISTING_PATH = "/remote-dev-jobs";

interface RemoteOkJobPosting {
  description?: string;
}

/**
 * Parses one `tr.job` row's embedded schema.org/JobPosting JSON-LD block, if present and
 * well-formed. Real-world RemoteOK data is inconsistent here: a spike sample found roughly 1 in 4
 * rows has a JSON-LD block that fails to parse (unescaped characters from the job description
 * leaking into the JSON), so a parse failure is expected, not exceptional — callers must fall
 * back to the row's `data-*` attributes rather than treating it as a critical error.
 */
function parseJobPostingJsonLd(row: ReturnType<ReturnType<typeof cheerio.load>>): RemoteOkJobPosting | null {
  const raw = row.find('script[type="application/ld+json"]').first().html();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RemoteOkJobPosting;
  } catch {
    return null;
  }
}

/**
 * Note on fields deliberately NOT extracted from the JSON-LD block, mirroring habr_career's
 * "don't store a placeholder as if it were real data" precedent (see habrCareerStrategy.ts's
 * salary comment):
 *
 * - `baseSalary`: a spike sample of 50 listing rows found the exact same "80000-150000 USD/YEAR"
 *   value on every single row, including on rows with clearly non-engineering titles ("Wholesale",
 *   "Open Vacancies") — this is boilerplate schema.org filler RemoteOK emits for Google Jobs
 *   indexing, not a real per-employer figure. Not stored (also consistent with the "defer salary"
 *   decision locked for this increment).
 * - `jobLocationType` / `jobLocation`: also identical ("TELECOMMUTE" / "Anywhere") across every
 *   sampled row — the same boilerplate pattern as salary, not a genuine per-job location signal.
 *   `isRemote` is instead hardcoded `true` below: RemoteOK is a 100%-remote job board by design,
 *   so this is a true statement about the source, not a guess derived from unreliable per-row data.
 */
function parseListingPage(html: string, source: CrawlSource): RawVacancy[] {
  const $ = cheerio.load(html);
  const vacancies: RawVacancy[] = [];

  $("tr.job").each((_, el) => {
    const row = $(el);
    const externalId = row.attr("data-id");
    const href = row.attr("data-href") || row.attr("data-url");
    const title = row.find("h2").first().text().trim();
    if (!externalId || !href || !title) return;

    const company = row.attr("data-company")?.trim() || null;
    const epoch = row.attr("data-epoch");
    const postedAt = epoch ? new Date(Number(epoch) * 1000).toISOString() : null;

    // Each tag renders twice in the DOM (desktop + mobile layout variants of the same row), so
    // dedupe before joining - otherwise skillsSummary would read "React, React, Node, Node, ...".
    const tags = [...new Set(row.find(".tags .tag").map((_i, t) => $(t).text().trim()).get())].filter(
      Boolean,
    );

    const jobPosting = parseJobPostingJsonLd(row);

    vacancies.push({
      externalId,
      title,
      company,
      url: new URL(href, source.baseUrl).toString(),
      postedAt,
      sourceId: source.id,
      description: jobPosting?.description ? htmlToText(jobPosting.description) : null,
      isRemote: true,
      skillsSummary: tags.length > 0 ? tags.join(", ") : null,
    });
  });

  return vacancies;
}

/**
 * Puppeteer-based strategy for RemoteOK. Unlike habrCareerStrategy, there is no `enrichDetails`
 * step: a spike confirmed the listing page's `tr.job` rows already carry everything the detail
 * page would (description, tags, company, posted date) via each row's own embedded JSON-LD block
 * plus `data-*` attributes — a per-vacancy detail crawl would just re-fetch the same information
 * at extra cost to the source.
 */
export const remoteOkStrategy: CrawlStrategy = {
  async crawl(source: CrawlSource): Promise<CrawlResult> {
    const pageUrl = new URL(LISTING_PATH, source.baseUrl).toString();

    const { html, cacheHit } = await getOrFetch(source.id, pageUrl, async () => {
      await waitForSlot(source.id, source.defaultDelayMs);
      const browser = await puppeteer.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);
        await page.goto(pageUrl, {
          waitUntil: "networkidle2",
          timeout: NAVIGATION_TIMEOUT_MS,
        });
        return await page.content();
      } finally {
        // One browser per crawl() call, not per page - RemoteOK has a single listing page to
        // fetch (see LISTING_PATH), so there's only ever one launch/close pair per run anyway,
        // but a future multi-page source built on this pattern should keep it that way rather
        // than relaunching Chromium per page.
        await browser.close();
      }
    });

    const vacancies = parseListingPage(html, source);
    return {
      vacancies,
      pageLogs: [`fetched listing (cache: ${cacheHit ? "hit" : "miss"}, ${vacancies.length} vacancies)`],
    };
  },
};
