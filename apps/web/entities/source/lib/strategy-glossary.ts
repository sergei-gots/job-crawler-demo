/**
 * Plain-English expansions for `{{term}}` markup inside `StrategyStep` content (see
 * `crawler/types.ts`'s `StrategyStep` in apps/api). Not a fact about any one strategy's
 * mechanism — those live in `apps/api` (`steps`/`description`) to avoid drift. This is a fixed,
 * small vocabulary for explaining jargon to a reader, which is a presentation-layer concern with
 * nothing on the backend for it to drift from.
 *
 * Add an entry here whenever a strategy file wraps a new term in `{{...}}` — StrategyFlow warns
 * in development if a term has no matching entry.
 */
export const STRATEGY_GLOSSARY: Record<string, string> = {
  "cf-mitigated": 'Cloudflare response header value ("cf-mitigated: challenge") indicating the request was served a bot-mitigation challenge instead of the real page.',
};
