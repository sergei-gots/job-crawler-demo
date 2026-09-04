import axios from "axios";
import puppeteer, { type Browser } from "puppeteer";
import * as cheerio from "cheerio";
import type { CrawlSource } from "@prisma/client";
import { getOrFetch } from "../pageCache.js";
import { htmlToText } from "../htmlToText.js";
import { waitForSlot } from "../rateLimiter.js";
import { applyVacancyCap } from "../vacancyCap.js";
import { upsertVacancy } from "../../search/upsertVacancy.js";
import type { CrawlResult, CrawlStrategy, EnrichDetailsResult, LogProgress, RawVacancy } from "../types.js";

// A real desktop Chrome UA, same rationale as remoteOkStrategy.ts. weworkremotely.com 403s plain
// (non-browser) requests via a Cloudflare JS challenge (`cf-mitigated: challenge`) on the category
// listing page, so crawl() goes through Puppeteer, same precedent as RemoteOK.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0 Safari/537.36";

const NAVIGATION_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;

// The category slug that actually resolves (confirmed live 2026-09-04) - the shorter
// "remote-programming-jobs" slug 301-redirects to this one.
const LISTING_PATH = "/categories/remote-full-stack-programming-jobs";

// The RSS feed for the SAME category as LISTING_PATH (confirmed live: both return the identical
// 120 jobs, 1:1 slug-for-slug) - deliberately not the site-wide /remote-jobs.rss feed, which would
// only partially overlap with what crawl() actually listed.
const RSS_PATH = "/categories/remote-full-stack-programming-jobs.rss";

async function fetchViaBrowser(browser: Browser, url: string): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(USER_AGENT);
    await page.goto(url, { waitUntil: "networkidle2", timeout: NAVIGATION_TIMEOUT_MS });
    return await page.content();
  } finally {
    await page.close();
  }
}

/**
 * Parses the category listing page. Row markup confirmed live (2026-09-04) via DevTools
 * inspection: each real listing is `li.new-listing-container` containing an
 * `a.listing-link--unlocked` (the only stable per-listing identifier is the URL slug after
 * `/remote-jobs/` - unlike habr's numeric vacancy id or RemoteOK's `data-id`, WWR has no numeric
 * id at all). A handful of rows (ads/promoted listings, ~2/122 in the sampled category) have no
 * such link and are naturally skipped, the same way a habr card missing its vacancy href is
 * skipped.
 *
 * Job-type/location tags (`.new-listing__categories__category`, e.g. "Full-Time", "Anywhere in
 * the World") are deliberately NOT parsed here - confirmed live that their count/order varies
 * per row (some rows have 2, others 4, mixing "Featured"/"Top 100" badges in with the real
 * type/region tags at no fixed position), so there's no reliable positional field to extract -
 * same "don't store a placeholder as if it were real data" principle as habr's dropped salary and
 * RemoteOK's dropped baseSalary/jobLocation. Real location/remote data comes from the RSS feed
 * instead (see parseWeWorkRemotelyRssFeed).
 */
export function parseWeWorkRemotelyListing(html: string, source: CrawlSource): RawVacancy[] {
  const $ = cheerio.load(html);
  const vacancies: RawVacancy[] = [];

  $("li.new-listing-container").each((_, el) => {
    const row = $(el);
    const link = row.find("a.listing-link--unlocked").first();
    const href = link.attr("href");
    const externalId = href?.match(/\/remote-jobs\/([^/?#]+)/)?.[1];
    const title = row.find(".new-listing__header__title").first().text().trim();
    if (!externalId || !href || !title) return;

    const company = row.find(".new-listing__company-name").first().text().trim() || null;

    vacancies.push({
      externalId,
      title,
      company,
      url: new URL(href, source.baseUrl).toString(),
      // Listing only shows a relative label ("4d", "NEW"), not a real timestamp - left null here
      // rather than guessing an exact time; enrichDetails fills in the real pubDate from the RSS
      // feed when a match exists.
      postedAt: null,
      sourceId: source.id,
    });
  });

  return vacancies;
}

/**
 * Parses the category's RSS feed into a slug-keyed lookup of enrichment fields. Each `<item>`'s
 * `<link>`/`<guid>` carries the same `/remote-jobs/<slug>` URL as the HTML listing, so the two are
 * joined by slug rather than by any RSS-specific id.
 *
 * Chosen over per-vacancy Puppeteer detail-page fetches (the original design) after a live
 * verification run found headless Puppeteer degraded after the first successful detail-page
 * navigation: only 1/5 detail pages returned a page with its JobPosting JSON-LD intact (the other
 * 4 came back with the block missing, even though re-opening the same URLs in a real browser
 * session immediately after showed the block WAS genuinely present - a Cloudflare
 * bot-fingerprinting response to repeated automated navigations within one session, not a
 * per-vacancy data gap). The RSS feed is not Cloudflare-gated at all (plain axios request, 200,
 * no challenge - confirmed live), and one request covers every vacancy in the category at once,
 * so it replaces the whole per-vacancy Puppeteer loop rather than trying to make that loop more
 * resilient (stealth plugins, longer delays, etc. - left as documented alternatives, not applied).
 */
export function parseWeWorkRemotelyRssFeed(xml: string): Map<string, Partial<RawVacancy>> {
  const $ = cheerio.load(xml, { xmlMode: true });
  const bySlug = new Map<string, Partial<RawVacancy>>();

  $("item").each((_, el) => {
    const item = $(el);
    const link = item.find("link").first().text().trim();
    const slug = link.match(/\/remote-jobs\/([^/?#]+)/)?.[1];
    if (!slug) return;

    // <description> arrives HTML-entity-double-encoded, same issue as the JobPosting JSON-LD this
    // replaced (confirmed live: the raw XML literally contains the six characters "&lt;p&gt;", not
    // a real "<p>" byte) - one cheerio .text() decode pass turns that into real markup, which
    // htmlToText can then strip normally on a second pass.
    const rawDescription = item.find("description").first().text();
    const decodedDescription = cheerio.load(rawDescription).text();

    const region = item.find("region").first().text().trim() || null;
    const skills = item.find("skills").first().text().trim() || null;
    const pubDate = item.find("pubDate").first().text().trim();

    bySlug.set(slug, {
      description: htmlToText(decodedDescription),
      // <region> (e.g. "Anywhere in the World", "USA Only") is always populated, unlike the
      // JobPosting JSON-LD approach this replaced, where jobLocation was only present for
      // geo-restricted postings - a strictly more complete signal for the same field.
      location: region,
      // WWR is a 100%-remote job board by design (same rationale as RemoteOK's hardcoded true).
      isRemote: true,
      postedAt: pubDate ? new Date(pubDate).toISOString() : null,
      // <skills> is empty on plenty of postings (confirmed live) - only set when non-empty, so a
      // blank tag doesn't clobber a previously-stored value with an empty string.
      ...(skills ? { skillsSummary: skills } : {}),
    });
  });

  return bySlug;
}

/**
 * Puppeteer-based strategy for WeWorkRemotely: a listing pass (crawl) via Puppeteer, followed by
 * an RSS-based enrichment pass (enrichDetails) - see parseWeWorkRemotelyRssFeed for why RSS,
 * not a second round of Puppeteer detail-page fetches like habrCareerStrategy.
 *
 * No real listing pagination exists: `?page=2` on the category URL was confirmed live to return
 * byte-for-byte the same rows as `?page=1` (same finding as RemoteOK's `?page=2` spike), so
 * crawl() fetches LISTING_PATH exactly once and relies on `applyVacancyCap` for volume control,
 * rather than looping over `source.maxVacanciesToCrawl`-many pages the way habr does.
 *
 * Consequence: `maxVacanciesToCrawl` is a ceiling, not a guarantee, for this source. The category
 * page shows every currently-open posting in one shot (confirmed ~120 live on 2026-09-04) - unlike
 * habr's page-based pagination, where a deeper page reaches further into an actual archive, there
 * is no "next page" of older WWR postings to fetch. Setting the cap above the category's real
 * current posting count (e.g. 200) simply returns however many postings actually exist, same as
 * already true for RemoteOK's fixed ~50-row listing.
 */
export const weWorkRemotelyStrategy: CrawlStrategy = {
  description: "Puppeteer (listing — Cloudflare-gated) + RSS feed via Axios (detail enrichment)",

  async crawl(source: CrawlSource): Promise<CrawlResult> {
    const pageUrl = new URL(LISTING_PATH, source.baseUrl).toString();

    const { html, cacheHit } = await getOrFetch(source.id, pageUrl, async () => {
      await waitForSlot(source.id, source.defaultDelayMs);
      const browser = await puppeteer.launch({ headless: true });
      try {
        return await fetchViaBrowser(browser, pageUrl);
      } finally {
        await browser.close();
      }
    });

    const parsed = parseWeWorkRemotelyListing(html, source);
    const { vacancies, truncated } = applyVacancyCap(parsed, source.maxVacanciesToCrawl);
    const pageLogs = [`fetched listing (cache: ${cacheHit ? "hit" : "miss"}, ${parsed.length} vacancies)`];
    if (truncated) {
      pageLogs.push(`reached maxVacanciesToCrawl (${source.maxVacanciesToCrawl}) - truncated`);
    }

    return { vacancies, pageLogs };
  },

  // A single RSS fetch (plain axios, no Puppeteer, no Cloudflare challenge - see
  // parseWeWorkRemotelyRssFeed) covers every vacancy in the category at once, so there's no
  // per-vacancy fetch/retry loop here, unlike habrCareerStrategy's enrichDetails. A vacancy whose
  // slug isn't in the feed (it only carries the category's current items, not a full history) is
  // logged and skipped, not treated as an error - that's an expected "outside the feed's window"
  // case, not a parse/fetch failure.
  async enrichDetails(
    source: CrawlSource,
    vacancies: RawVacancy[],
    isCancelled: () => boolean,
    logProgress: LogProgress,
  ): Promise<EnrichDetailsResult> {
    const rssUrl = new URL(RSS_PATH, source.baseUrl).toString();

    const { xml, cacheHit } = await getOrFetch(source.id, rssUrl, async () => {
      await waitForSlot(source.id, source.defaultDelayMs);
      const response = await axios.get<string>(rssUrl, {
        headers: { "User-Agent": USER_AGENT },
        timeout: REQUEST_TIMEOUT_MS,
      });
      return response.data;
    }).then((result) => ({ xml: result.html, cacheHit: result.cacheHit }));

    const bySlug = parseWeWorkRemotelyRssFeed(xml);
    await logProgress(`fetched RSS feed (cache: ${cacheHit ? "hit" : "miss"}, ${bySlug.size} entries)`);

    let enrichedCount = 0;
    const total = vacancies.length;

    for (const [index, vacancy] of vacancies.entries()) {
      if (isCancelled()) break;

      const details = bySlug.get(vacancy.externalId);
      if (!details) {
        await logProgress(
          `vacancy ${index + 1}/${total} (${vacancy.externalId}) not found in RSS feed - skipped`,
          "WARN",
        );
        continue;
      }

      await upsertVacancy({ ...vacancy, ...details });
      enrichedCount += 1;
      await logProgress(`enriched vacancy ${index + 1}/${total}: ${vacancy.title}`);
    }

    return { enrichedCount };
  },
};
