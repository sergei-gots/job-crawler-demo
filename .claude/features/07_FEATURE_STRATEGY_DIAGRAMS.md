# FEATURE: In-App Crawling Strategy Diagrams (Increment 7)

## Overview

Earlier work in this project produced a standalone diagram (a Claude Artifact) visualizing how
each `CrawlSource` is actually crawled — the fetch mechanism per phase, and for `RemoteOK`/
`WeWorkRemotely` specifically, the real problems hit (Cloudflare blocks, headless-Puppeteer
fingerprinting) and the fixes applied. That artifact lived outside the repo — a private,
ephemeral claude.ai-hosted page, not something that survives independently of the chat session
that created it or travels with the project.

This increment turns the same content into a permanent, in-app asset:

1. A per-source **"Applied crawling strategy"** panel on the Source detail page — collapsed by
   default, same as the existing "Execution logs"/"Vacancies" panels — showing just that source's
   own step chain, click-to-expand per step.
2. A **"Strategies"** panel on the Sources list page for comparing multiple sources side by side
   via checkboxes (all unchecked by default) — reuses the exact same rendering component as (1).

## Decisions locked with the user

- **No diagramming library.** Mermaid and React Flow were both considered and rejected. The
  comparison page only ever shows linear per-source step chains side by side, not an
  interconnected graph. React Flow's "auto-layout" doesn't actually hold — it still requires
  manual `{x, y}` per node, the same work as hand-rolling, and its click-interactivity story
  (nodes are real React components) doesn't buy anything extra once the diagram is a single
  column of steps, not a many-to-many graph. Mermaid's click-interactivity requires bridging its
  rendered-SVG output back into React state via its own callback API, rather than being native.
  A small custom React component, driven by a plain typed data array, gives the same "data
  describes the diagram, one renderer draws it" separation the user asked about up front (their
  original JSON/YAML-engine idea) without adding a dependency, and fits this codebase's existing
  convention of hand-rolled `shared/ui` components.
- **Step data lives on each `CrawlStrategy` object in `apps/api`, not a separate frontend file —
  a false start caught during review.** The first draft of this plan put a hand-authored
  `strategySteps` lookup table in `apps/web/entities/source/lib/`. Flagged before implementation:
  that would recreate the exact problem this project's Increment 6 just fixed for
  `CrawlSource.type` — a second, disconnected copy of a fact (what a strategy does, what broke,
  what fixed it) that could silently drift from the code whenever a strategy file changes, with
  nothing but a skill/reminder to catch it. Applied the same fix used for
  `CrawlStrategy.description`: `steps: StrategyStep[]` lives directly on each strategy object,
  next to `description`. The API computes and serves it as `strategySteps` (same
  `getStrategy(source)?.steps` pattern as `strategyDescription`). The frontend `StrategyFlow`
  component renders whatever `source.strategySteps` the API sends — no separate data file to keep
  in sync, because there's only one copy, in the same file as the code it describes. No new
  skill was needed — `data-sources` already triggers on `CrawlStrategy` edits; it now also notes
  that `steps` must be kept accurate alongside `description`.
- **Sources without a strategy** (currently only `Craigslist`) get a small **generic** 2-step
  fallback computed in `sources.service.ts` ("crawl triggered" → "no `CrawlStrategy` implemented
  yet, WARN logged, 0 vacancies") — not source-specific research content. Craigslist's actual
  anti-scraping enforcement-history finding stays in the `data-sources` skill only; the in-app
  diagram's job is to show mechanism actually executed, not carry research prose that has no
  natural home on a nonexistent strategy object.
- **`StrategyStep.detail` is a small structured object** (`method?`, `explanation`, `result?`),
  not a free-form prose string — rendered as a compact definition list on click-to-expand.
  `method` names the library call this step actually makes (e.g. "Puppeteer —
  page.setUserAgent()"), not the internal function/file that wraps it (that's already visible by
  browsing the repo and adds no new information); omitted for steps with no library call
  (decisions, pure logic). Considered and rejected a `code`-as-file-reference field first, for
  the same reason.
- **Compare panel starts empty by design.** Closed by default (same as every other panel);
  once opened, shows only an explanatory caption ("Crawling strategy for the sources you select
  below.") and all-unchecked checkboxes — nothing else renders until a source is checked. Earlier
  alternatives considered and rejected: defaulting all checkboxes to checked (renders every
  source's full chain unprompted — "rendering everything is unreasonable"), and pre-rendering a
  compact summary-card row for all sources before any selection (adds a second visual state to
  design and maintain for marginal benefit once the caption already sets expectations).
- **Comparison scope: sources list page, not a separate route.** Raised and confirmed during
  discussion — a future filterable/URL-addressable comparison view was discussed but explicitly
  deferred; see Out of scope.

## What was built

1. `apps/api/src/crawler/types.ts`: added `StrategyStepType`, `StrategyStep` (with the
   `method`/`explanation`/`result` detail shape), and a required `steps: StrategyStep[]` field on
   `CrawlStrategy`.
2. `habrCareerStrategy.ts` / `remoteOkStrategy.ts` / `weWorkRemotelyStrategy.ts`: each gained a
   `steps` array (5, 5, and 9 steps respectively) ported from the earlier artifact's content and
   this project's `06_FEATURE_WEWORKREMOTELY_AND_VACANCY_CAP.md`, not re-derived from scratch.
   `weWorkRemotelyStrategy.ts`'s chain is the only one with two full problem→fix cycles (the
   listing Cloudflare block, then the separate headless-Puppeteer-fingerprinting problem that
   drove the RSS-feed pivot).
3. `apps/api/src/sources/sources.service.ts`: `withStrategyDescription` renamed to
   `withStrategyInfo`, extended to compute `strategySteps` (real steps, or the generic
   `NOT_IMPLEMENTED_STEPS` fallback) alongside `strategyDescription`, in the same three call sites
   (`listSources`, `getSourceByIdWithStrategyInfo`, `updateSourceSettings`).
4. `apps/web/entities/source/lib/get-sources.ts`: added matching `StrategyStep`/
   `StrategyStepType` types and a `strategySteps` field on `Source` (this monorepo doesn't share
   types between `apps/api`/`apps/web`; each side declares its own matching interface, same as
   every other `Source` field).
5. New `apps/web/entities/source/ui/strategy-flow.tsx`: `<StrategyFlow steps={...} />`. A vertical
   chain of steps connected by simple text arrows (`↓`), no diagramming primitive. `decision`
   steps render as a dashed pill; `problem` steps use `text-destructive`/`border-destructive/40`
   (matching this codebase's existing `CrawlLog` `ERROR`-coloring convention — no new color token
   introduced); every other type uses plain `border-border`/`text-foreground`. Each step is a
   `<button>` that toggles a local `expanded` state, revealing `method`/`explanation`/`result` as
   a small definition list when a `detail` is present.
6. `apps/web/widgets/source-detail/ui/source-detail-page.tsx`: new `showStrategy` state and
   "Applied crawling strategy" `Card` panel, mirroring the exact `showLogs`/`showVacancies`
   skeleton, placed after the existing "Vacancies" card.
7. `apps/web/widgets/sources/ui/sources-page.tsx`: new `showStrategies` state, a
   `comparedSourceNames: Set<string>` selection state, and a "Strategies" `Card` panel (same
   toggle skeleton) with a caption, one `Checkbox`+`Label` per source (`shared/ui/checkbox.tsx`,
   already existed — not a new dependency), and a `grid md:grid-cols-2` of `<StrategyFlow>`
   instances for whichever sources are checked.
8. Docs synced: this doc; `.claude/skills/data-sources/SKILL.md` (one line on keeping `steps`
   accurate); `ARCHITECTURE.md` (`CrawlSource` notes + `CrawlStrategy` key-interfaces entry).

## Data model changes

None to the database. `steps`/`strategySteps` are code/API-computed, exactly like
`description`/`strategyDescription` before them — no migration.

## Verification (manual, per CLAUDE.md's Testing Philosophy)

- [x] `apps/api`: `npx tsc --noEmit` clean; `npm run test` 34/34 (unaffected — no test asserts an
      exhaustive shape on strategy objects that `steps` would break).
- [x] `apps/web`: `npx tsc --noEmit` clean.
- [x] `GET /sources/:id` (curl, authenticated) confirmed to return real, multi-step
      `strategySteps` for `RemoteOK`/`WeWorkRemotely`/`Habr Career`, and the generic 2-step
      fallback for `Craigslist`.
- [x] Source detail page (WeWorkRemotely): "Applied crawling strategy" panel collapsed by
      default; expanding it renders the full 9-step chain with both problem→fix cycles visible;
      clicking a step (e.g. "PROBLEM - Cloudflare JS challenge") reveals its `explanation`/
      `result` inline, toggle arrow flips ▾/▴.
- [x] Sources list page: "Strategies" panel collapsed by default; expanding it shows only the
      caption and four unchecked checkboxes (RemoteOK, WeWorkRemotely, Habr Career, Craigslist) —
      nothing else rendered. Checking RemoteOK and WeWorkRemotely renders both chains side by
      side in a two-column grid, live as checkboxes are toggled.

## Out of scope

- A separate, URL-addressable comparison route/view — the checkbox-driven panel on the existing
  Sources list page covers the discussed use case; a dedicated page was raised and deferred.
- Hover-based tooltips (`@base-ui/react/tooltip`/`popover`, already a project dependency, unused
  so far) — click-to-expand was judged sufficient; revisit only if click-to-expand proves
  awkward in practice.
- Craigslist's own step chain — stays on the generic 2-step fallback until it gets a real
  `CrawlStrategy`.
