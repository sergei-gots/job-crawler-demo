import * as cheerio from "cheerio";

/**
 * Converts an HTML fragment (typically a JobPosting's `description`) to plain text, preserving
 * line breaks so paragraphs/list items don't run together. Shared by habrCareerStrategy and
 * remoteOkStrategy, both of which get their description from an HTML-bearing JSON-LD field.
 */
export function htmlToText(html: string): string | null {
  // <br> is a void element (no closing tag), so it needs its own pattern separate from the other
  // block tags below; without this, cheerio's .text() would run adjacent lines together.
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|h[1-6])>/gi, "\n");
  const $ = cheerio.load(withBreaks);
  const text = $.text().replace(/\n{3,}/g, "\n\n").trim();
  return text || null;
}
