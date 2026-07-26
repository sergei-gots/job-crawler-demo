import axios from "axios";
import * as cheerio from "cheerio";
import type { CrawlSource } from "@prisma/client";
import { getOrFetch } from "../pageCache.js";
import { waitForSlot } from "../rateLimiter.js";
import type { CrawlResult, CrawlStrategy, RawVacancy } from "../types.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

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

/**
 * Handles habr_career's vacancy listing, confirmed server-rendered (no JS execution needed) via
 * a manual curl check, even though CrawlSource.type is seeded as DYNAMIC. Selectors are specific
 * to habr_career's markup, not a generic HTML scraper.
 */
export const axiosCheerioStrategy: CrawlStrategy = {
  async crawl(source: CrawlSource): Promise<CrawlResult> {
    const vacancies: RawVacancy[] = [];
    const pageLogs: string[] = [];

    for (let page = 1; page <= source.maxPagesPerRun; page += 1) {
      const pageUrl = new URL("/vacancies", source.baseUrl);
      if (page > 1) pageUrl.searchParams.set("page", String(page));

      const { html, cacheHit } = await getOrFetch(source.id, pageUrl.toString(), async () => {
        await waitForSlot(source.id, source.defaultDelayMs);
        const response = await axios.get<string>(pageUrl.toString(), {
          headers: { "User-Agent": USER_AGENT },
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
};
