# FEATURE: Additive Jitter on the Crawl Rate Limiter (Increment 8)

## Overview

Prompted by a discussion of WeWorkRemotely's headless-Puppeteer fingerprinting problem
(`06_FEATURE_WEWORKREMOTELY_AND_VACANCY_CAP.md`) — the user asked whether the observed
degradation (works once, then blocked) could be related to requests hitting the source at a
perfectly regular interval, which is itself a signal that separates automated traffic from real
clients. `waitForSlot` (`apps/api/src/crawler/rateLimiter.ts`) previously waited exactly
`source.defaultDelayMs` between fetches to the same source, every time — no variance at all.

This increment adds random jitter to that wait, applied to every source's rate limiting (not a
WeWorkRemotely-specific workaround) since irregular request timing is a general politeness/realism
improvement, not something specific to one source's anti-bot posture.

## Decisions locked with the user

- **Purely additive jitter (0-7000ms added on top of `delayMs`), not a symmetric ±5s.** A
  symmetric jitter (e.g. `delayMs ± 5000`) risks undercutting the source's configured courtesy
  delay — for a source seeded near the schema's allowed minimum (1000ms), `-5000ms` would go
  negative and get clamped to near-zero, defeating the point of the rate limiter entirely, which
  would then need extra clamping logic to guard against. An additive-only jitter can never reduce
  the enforced spacing below `defaultDelayMs`, no matter how small that value is — it can only
  make a crawl more polite (longer gaps), never less. No clamping needed by construction.
- **Applied uniformly in `waitForSlot`**, not per-strategy — every `getOrFetch`/`waitForSlot` call
  site across all three implemented strategies (`habrCareerStrategy.ts`, `remoteOkStrategy.ts`,
  `weWorkRemotelyStrategy.ts`) already routes through this one function, so the change required no
  edits to the strategy files themselves.
- **Not documented as a change to any `CrawlStrategy.steps` diagram content.** Checked per the
  process this project settled on for keeping strategy diagrams accurate (see
  `07_FEATURE_STRATEGY_DIAGRAMS.md` / `data-sources` skill): none of the existing `StrategyStep`
  entries describe the exact rate-limit delay value, so nothing in the diagrams became inaccurate.
  Confirmed explicitly with the user rather than assumed.

## What was built

`apps/api/src/crawler/rateLimiter.ts`:
- `MAX_JITTER_MS = 7000` and a `withJitter(delayMs)` helper (`delayMs + random(0, 7000)`).
- `waitForSlot` computes `jitteredDelayMs = withJitter(delayMs)` once per call and uses it both
  for the `remaining`-wait calculation and for the Redis key's `PX` expiry (so the "last fetched
  at" bookkeeping stays consistent with the actual enforced spacing for that call).

## Data model changes

None.

## Verification

- [x] `apps/api`: `npx tsc --noEmit` clean; `npm run test` 34/34 (no test asserts an exact delay
      value, so the added randomness didn't require any test changes).

## Out of scope

- Simulated mouse movement / scroll behavior (e.g. via `ghost-cursor`) before Puppeteer
  navigations — discussed as a further anti-fingerprinting lever but not implemented; flagged as
  likely addressing a different detection vector than the one actually observed (the WWR
  degradation pattern looks more like session/IP-level correlation across requests than
  per-page DOM-signal detection, so mouse simulation isn't guaranteed to fix it).
- Headful (non-headless) Puppeteer mode as an alternative to the RSS-feed enrichment switch —
  same status: discussed, not tried, not committed to.
- Per-source jitter range configuration (`MAX_JITTER_MS` is a single shared constant, not a
  `CrawlSource` field) — no source has asked for a different jitter window yet.
