# CLAUDE.md - Job-Crawler-Demo

## Project Overview

**Project Name:** Job-Crawler-Demo  
**Description:** A modular demonstration web application showcasing a modern web crawling and data processing stack, inspired by enterprise data crawling systems (e.g. SAP-style).

**Goal:**  
Create a clean, well-structured MVP that demonstrates the full tech stack: TypeScript + Node.js crawling framework with Puppeteer, Elasticsearch, Redis, AI enrichment, and user personalization.

## Tech Stack

### Backend (`apps/api`)

- **TypeScript + Node.js + Express** — Core backend and REST API
- **Puppeteer** — Crawling JavaScript-rendered pages (chosen per source, via `CrawlSource.type`)
- **Axios + Cheerio** — Fast static page crawling
- **PostgreSQL** — Store users, crawl runs, crawl logs, settings
- **Redis** — Rate limiting, simple crawl run state, caching
- **Elasticsearch** — Main storage and search engine for crawled results
- **Coveo-like layer** — Light abstraction above Elasticsearch that mimics a Coveo-style
  search experience (facets, relevance sorting). Saved searches are **out of scope for MVP**.
- **JWT Authentication** — User registration and login. Crawling and search are shared/global,
  not owned per user — see Security Considerations.
- **Claude API** — AI enrichment (summarization, skill extraction, categorization).
  Start with a `MockAIEnricher`; wire the real API (key in `.env`) in a later stage.
- **Winston** — Structured logging

### Frontend (`apps/web`)

- **Next.js + React** — Dashboard SPA, organized with **Feature-Sliced Design (FSD)**.
  Reuses the FSD skeleton and auth flow patterns from the Expense Tracker project
  (login/register, `entities/session`, `useRequireAuth`, `shared/lib/api.ts`, `shared/ui`),
  but talks to **our Express API** — we do NOT adopt NestJS.
- **shadcn/ui** — UI components routed into `shared/ui`

### Infrastructure

- **Docker + Docker Compose** — Local environment (Postgres, Redis, Elasticsearch)

## Data Sources

Given a 2-week timeline, MVP scope is **one source, done well**, rather than three done thinly:

| Key              | Site                     | Status   | Type (`CrawlSource.type`)                                     | Notes                                                        |
| ---------------- | ------------------------ | -------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| `habr_career`    | career.habr.com          | MVP      | `DYNAMIC` — but the vacancies listing was found fully server-rendered on a manual check; Puppeteer may not actually be required, re-verify when building the real crawler | RU tech jobs; good fit for AI skill-extraction demo |
| `remoteok`       | remoteok.com             | post-MVP | `DYNAMIC` — `robots.txt` looks permissive (`Crawl-delay: 1`), but the site actively returns `403` on a plain non-browser request (Cloudflare bot check); a real browser/Puppeteer is needed to get past the wall, not just to render JS | Tech jobs with ready-made skill tags — good AI skill-extraction fit; replaces `moikrug` |
| `weworkremotely` | weworkremotely.com       | post-MVP | `STATIC` — `robots.txt` is `Allow: /` aside from account/admin paths; listings confirmed server-rendered on a manual check | Simple, long-established scraper-friendly job board |
| `craigslist`     | craigslist.org (SW jobs) | post-MVP | `STATIC` — listings are server-rendered and accessible without login on a single request, but craigslist has a documented history of legal/technical enforcement against scrapers (e.g. the 3taps/PadMapper case); expect rate-limiting or CAPTCHA under sustained automated access even though a one-off check looks simple | International example, multiple cities |

`moikrug` is gone as a distinct source — `moikrug.ru` now permanently redirects (301, both
`robots.txt` and the site itself) to `career.habr.com`; Habr absorbed it. Replaced by `remoteok`
and `weworkremotely` above.

`remoteok`, `weworkremotely`, and `craigslist` are deferred — add them later as additional
`CrawlStrategy` adapters if time allows, without changing the crawler architecture.

All four are already seeded as `CrawlSource` rows (`apps/api/prisma/seed.ts`) so they're
selectable on the Sources page. Only `habr_career` has a real `CrawlStrategy` (Axios+Cheerio,
listing crawl plus per-vacancy detail crawl — see the "Real crawler..." and "Vacancy detail
crawl..." features in `.claude/features/`); the other three don't have a parser yet, so
triggering a crawl for them (or using "crawl all") logs a `WARN` and skips them rather than
failing the run. Crawling is triggered directly per source via `POST /sources/:id/crawl` — see
`.claude/features/FEATURE_CRAWL_SEARCH_SEPARATION.md` — there is no separate job entity that
picks which sources to run.

For each source we define: `type` (`STATIC`/`DYNAMIC` — determines Axios+Cheerio vs Puppeteer),
`defaultDelayMs`, base URL, and (eventually) the CSS selectors/fields to parse. This all lives on
the `CrawlSource` itself; there's no separate per-run configuration. Always respect the site's
`robots.txt` and apply rate limiting.

## Coding Standards

- Strict TypeScript usage (interfaces/types instead of `any`)
- Clean, modular, and extensible architecture
- Proper error handling and logging
- Async/await everywhere
- ESLint + Prettier
- Clear comments for complex logic

### Architecture methodologies (important — two different worlds)

- **Frontend (`apps/web`)** follows **Feature-Sliced Design (FSD)**: layers
  `app → widgets → features → entities → shared`. Import rule: a layer may only import
  from layers below it, never sideways or upward; cross-slice imports go through a slice's
  `index.ts` public API (no deep imports).
- **Backend (`apps/api`)** follows a **layered / modular** structure
  (`controllers → services → crawler/ai/search/auth → models`). This is NOT FSD — do not mix
  the two vocabularies.

## Git & Development Workflow

- Use meaningful commit messages in English.
- Work in feature branches (e.g. `feat/crawl-search-separation-3a`, `fix/crawler-rate-limit`).
- Keep `main` branch stable.
- Commit often, push regularly.
- All code must be in English.
- Claude drafts the commit message(s) and the pull request description for each step of work,
  in the usual format: a summary of what changed and why, plus a test plan / checklist of what
  still needs manual review or testing (e.g. "not yet covered by automated tests — verify
  manually: ..."). By default the user reviews the draft and creates the actual PR themselves.
  Claude may open the PR itself via `gh pr create` **only when explicitly asked** to do so in that
  moment (e.g. "create the PR", "open it via the link") — this is not a standing default, so ask
  again next time rather than assuming carryover. This does not change the merge rule below.
- **No automatic merges, ever.** Every change lands on a feature branch and goes through a PR;
  `main` only moves when the user reviews and merges it themselves. Claude never merges a PR,
  even if asked to "just finish it up" — merging is always a manual, explicit user action.
- Every PR description must include, in full: (1) a step-by-step account of what was actually
  done (not just a summary — enough detail that the user can follow the reasoning without
  re-reading the diff), and (2) a **review checklist** of concrete things the user should verify
  before merging (commands to run, URLs to open, edge cases to try, anything not covered by
  automated checks).

### Feature design docs (`.claude/features/`)

Every non-trivial feature or increment gets a design doc in `.claude/features/`, written (or
updated) as part of that work — not after. These docs are the durable record of **why**: the
code shows *what* was built, the doc captures the reasoning, the alternatives rejected, and the
decisions locked with the user so they aren't silently re-litigated later.

- **Naming**: `FEATURE_<SHORT_NAME>.md`, uppercase snake case (e.g.
  `FEATURE_VACANCY_DETAIL_CRAWL.md`). (One legacy file is misspelled `FEATIRE_...` — don't copy
  that; new docs use `FEATURE_`.)
- **Contents**, roughly in this order: a **Context/Overview** (the problem and intended outcome),
  a **Status** line (Planned / Implemented / etc.), **decisions locked with the user** (each with
  its rationale, so they read as settled, not open), explicit **scope boundaries** (what's
  deliberately out of scope and why), a phased **implementation plan / steps** as a checklist, and
  a **verification** section (how to test it end-to-end, per the Testing Philosophy below).
- **Keep it in sync**: when the work lands, update the doc's Status and check off its steps; when a
  later change invalidates a decision recorded there, update the doc in the same PR — same rule as
  for `CLAUDE.md`/`README.md`/`ARCHITECTURE.md` drift.
- A large effort may be split across several increments/PRs but share **one** feature doc with
  phased sections, rather than one doc per PR — keeps the whole reasoning in one place.

## User Stories (MVP)

As a user I can:

1. Register and log in (JWT Authentication)
2. View a list of predefined data sources (see Data Sources above)
3. Start / Stop a crawl for a source, or crawl all sources at once — crawling is a shared,
   global operation (not scoped to me); any logged-in user can trigger it (see Security
   Considerations). Crawl strategy, delay, and page depth are not configurable per run — they
   come from the selected `CrawlSource`'s own `type`/`defaultDelayMs`/`maxPagesPerRun`.
4. See the status and progress of a source's crawl runs, including execution logs
5. Search through all collected vacancies using Elasticsearch — free text plus facets
   (Specialization, Seniority level, Remote/On-site, Location, Company) and relevance sorting
6. Receive AI-enriched summaries of crawled content (future increment)

## Data Models (summary)

Full field definitions live in `ARCHITECTURE.md`. Core entities:

- **User** — PostgreSQL. Authentication only — see Security Considerations for why crawling and
  search have no per-user ownership.
- **CrawlSource** — PostgreSQL. A seeded, shared crawl target (name/baseUrl/type/rate-limit
  config). Crawling is triggered directly on a source, not via a separate job entity.
- **CrawlRun** — PostgreSQL. One crawl execution of one source: status, timestamps, vacancy
  count. Owns `CrawlLog[]`.
- **CrawlerResult** — Elasticsearch (primary). A crawled + AI-enriched vacancy, deduplicated by
  `sourceId:externalId` across the whole shared corpus.
- **CrawlLog** — PostgreSQL. Execution log lines per `CrawlRun`.

## Technical Guidelines & Axioms

- All code, documentation, comments, variable names, function names, folder names, and UI text must be in **English**.
- The entire project interface and user-facing content should be in English.
- Russian can only be used in personal development notes (`.notes/`, git-ignored).
- Crawling is global, not scoped to a user — see Security Considerations.
- Respect `robots.txt` and implement rate limiting (via Redis).
- Puppeteer vs Axios/Cheerio is chosen per source (`CrawlSource.type`), never a per-run setting.
- AI enrichment goes through an interface; ship a `MockAIEnricher` first, real Claude API later.
- Keep the architecture modular and easy to extend.
- Prefer simplicity for MVP (avoid over-engineering).
- Whenever a step changes, adds to, or invalidates something described in `CLAUDE.md`,
  `README.md`, or `ARCHITECTURE.md`, update the affected file(s) as part of that step —
  don't let the docs drift out of sync with the code.

## Security Considerations

- **Crawling is a shared, global operation, not owned per user.** Sources are shared seed data,
  and the corpus they produce in Elasticsearch is a single deduplicated collection
  (`sourceId:externalId`) — mirroring how ingestion/admin operations work against shared
  infrastructure in real search systems (Coveo, Elastic connectors). Any authenticated user can
  start/stop a crawl run for any source and see its status/logs; there is no per-user ownership
  check to bypass, because there is no owner. The per-source Redis rate limiter is what protects
  the source from abuse (repeated/overlapping crawl requests), not per-user gating.
- **No RBAC yet.** A production deployment would gate crawl-triggering behind an admin role; this
  MVP deliberately treats every logged-in user as trusted to trigger crawls — see
  `.claude/features/FEATURE_CRAWL_SEARCH_SEPARATION.md` for why this was deferred rather than
  built now.
- **Search is read-only and unscoped** — the search endpoint returns matches from the whole
  shared corpus; there's nothing to authorize per-result since nothing is owned per user.
- Client-side restrictions (disabled buttons while a crawl is `RUNNING`) are UX only —
  server-side, status-conditioned writes (the concurrency guard preventing two overlapping runs
  of the same source) are authoritative and re-checked on every request.

## Product UI Principles

This application is a crawler management console.

Prioritize:
- clarity of workflows over visual decoration
- showing crawl status and progress
- clear distinction between configuration (Sources) and results (Search)
- operational information visibility

Main user actions should be obvious:
- run a crawl (per source, or all sources)
- inspect a source's crawl status and logs
- search and filter results (facets)
- review history

## UI Design Guidelines

Reference screenshots live in `.claude/.design-samples/` (git-ignored, local-only).
Use those samples as the default visual language. Introduce new patterns only when the workflow
requires them.

- **Application pages should not use centered layouts.** Page content is left-positioned with
  breathing-room padding (`items-start justify-start p-8 md:p-16` for full-page forms like
  login/register; `justify-start p-4 md:p-8` for the main content area next to the sidebar) — this
  is the current choice for login/register too. Standalone marketing/auth screens may use centered
  layouts if explicitly designed that way (e.g. a future landing page) — this isn't a blanket ban,
  just the default for everything we've built so far.
- **Boxed sections, not flat lists.** Any logically distinct block of UI (a form, the sidebar's
  user info, the sidebar's nav) is wrapped in `shared/ui/card.tsx`'s `Card`/`CardHeader`/
  `CardTitle`/`CardDescription`/`CardContent` — not a bare `<div>`.
- **Separate cards, not dividers.** When two related sections sit in the same column (e.g. "Account
  details" and "Change password"), separate them with layout spacing (`gap-6` on the parent) —
  not a visible `<hr>` rule line.
- **Active navigation state must be visually distinguishable.** Prefer a border-based active state
  (`border border-border` on the active item, `border-transparent` on inactive ones to reserve the
  same width) unless another pattern is already established for that context.
- **Password fields always use `shared/ui/password-input.tsx`** (`PasswordInput`), never a bare
  `Input type="password"` — it's the standard show/hide-toggle wrapper for every password field
  app-wide (login, register, change-password, etc.).
- **Use design tokens, not hardcoded colors.** Prefer `text-muted-foreground`, `border-border`,
  `text-foreground` etc. (defined in `app/globals.css`) over hardcoded Tailwind colors like
  `text-zinc-500` — the codebase had drifted into mixing both; new/touched code should use tokens.
- **Auth-screen structure**: `CardTitle` + a one-line `CardDescription` explaining the action,
  full-width submit button (default `Button`, no `w-fit`). In-page forms (profile, settings)
  instead use `className="w-fit"` on their submit button — full-width there would look oversized
  next to a left-aligned card.
- **Typography hierarchy** — three levels, distinguished by size *and* weight together (not just a
  couple of pixels at the same weight), so page structure stays scannable at a glance:
  | Level | Component | Classes | Size / weight |
  | --- | --- | --- | --- |
  | Page title | `shared/ui/page-title.tsx`'s `PageTitle` (one `<h1>` per page) | `text-2xl font-semibold tracking-tight` | 24px / 600 |
  | Section heading | `shared/ui/card.tsx`'s `CardTitle` | `text-lg font-semibold` (`text-base font-semibold` in `size="sm"` cards) | 18px / 600 (16px / 600) |
  | Form label | `shared/ui/label.tsx`'s `Label` | `text-sm font-medium` | 14px / 500 |

  Always use `PageTitle` for a page's single top-level heading instead of a raw `<h1>` — it's the
  shared definition all pages inherit from, so a future hierarchy tweak stays a one-file change.
- **Button color hierarchy** — two levels, distinguished by fill, not by inventing new variants:
  | Level | Variant | Look | Used for |
  | --- | --- | --- | --- |
  | Primary action | `variant="default"` (`shared/ui/button.tsx`) | Medium-dark gray fill (`--primary: oklch(0.55 0 0)`), light text — deliberately *not* near-black | Main CTA per screen: Login, Register, Update profile |
  | Secondary action | `variant="secondary"` | Clearly gray fill (`--secondary: oklch(0.9 0 0)`), dark text — must read as visibly gray against a white `Card`, not blend into it | In-context actions on an existing item: Start / Stop a source crawl |

  Both colors are tokens in `app/globals.css` (`:root` block, light theme) — tune brightness there,
  not per-component. `--primary` went through several rounds of manual eyeballing (`0.205` too
  black → `0.32`/`0.42` still too dark → `0.55` approved); `--secondary` needed bumping from `0.97`
  (indistinguishable from the white `Card` background) to `0.9`. Do not reintroduce hardcoded
  Tailwind grays (`bg-zinc-600`, etc.) for buttons — extend these tokens instead.
- **Headings get their own (lighter) text color, body text doesn't.** `PageTitle` and `CardTitle`
  use a dedicated `--heading` token (`oklch(0.45 0 0)` light theme, ≈ Tailwind `zinc-600`) via the
  `text-heading` utility, deliberately lighter than `--foreground` (`0.145`, near-black) so titles
  read as less heavy. Regular text (labels, paragraphs, table cells) keeps using `--foreground` /
  `text-foreground` as before — do not point body text at `--heading`, and do not lighten
  `--foreground` itself to chase this look, since that token drives all default text app-wide and
  a jump to anything near `0.85` drops contrast on white to ~1.2:1 (fails WCAG, effectively
  invisible). `--heading` is intentionally left unchanged in the dark theme (same as dark
  `--foreground`) since the "too heavy" complaint was about the light theme only.
- **`Card` uses a real border, not a faint ring.** `border-2 border-border` (token `--border:
  oklch(0.85 0 0)` in light theme) — bumped up from the original near-invisible `ring-1
  ring-foreground/10` so cards visibly separate from the page background and from each other.
- **External/navigational links use the `text-link` utility, not a raw color or bare `<a>`.**
  Backed by a dedicated `--link` token (`oklch(0.42 0.14 258)` light theme — a muted dark blue, not
  the default-browser bright blue) so a link reads as a link without competing with `--primary`'s
  grayscale button hierarchy above. This is the first chromatic (non-grayscale) token in the
  palette — deliberate, to keep links visually distinct from every other UI signal, which are all
  achromatic. Pair with `hover:underline`. First use: the Sources table's Base URL column
  (`widgets/sources/ui/sources-page.tsx`).
- **User-facing text uses a plain hyphen (`-`), not an en dash (`–`) or em dash (`—`).** The
  longer dashes read as visually heavier/wider than intended at UI text sizes. Applies to
  `apps/web` UI strings (labels, placeholders, copy) — not to docs (`CLAUDE.md`, `README.md`,
  `ARCHITECTURE.md`) or code comments, where an em dash is fine.
- **`CrawlLog` lines are colored by `level`, not left uniformly `text-foreground`.** `ERROR`-level
  lines use `text-destructive` (the existing `--destructive` token); `INFO`/`WARN` keep the
  default `text-foreground` — no separate color introduced for `WARN` yet. First use: the Source
  detail page's Execution logs panel (`widgets/source-detail/ui/source-detail-page.tsx`). Extend
  this pattern (not a new ad-hoc color) if/when `WARN` gets its own styling.

## Testing Philosophy

- Primary testing method: **Manual testing** through the browser.
- The developer will manually check the web interface, user flows, and visual appearance.
- Do not use Claude Chrome Extension or any browser automation tools for regular development and testing unless explicitly requested.
- Automated tests (if any) will be added later for critical paths and regression.

**Manual Testing Goals:**

- Evaluate real User Experience (UX)
- Check visual layout and responsiveness
- Verify business workflows and usability
- Catch issues that automated tools often miss

**Before marking a feature as "Done":**

- Developer must perform manual testing
- Provide a short **Manual Testing Checklist** for the implemented feature

## Project Structure (Target)

Monorepo with two apps:

```
/apps
  /api                 # Express backend
    /src
      /config
      /controllers
      /services
      /crawler         # crawler framework (Puppeteer + Axios/Cheerio strategies)
      /ai              # AIEnricher interface, MockAIEnricher, ClaudeEnricher
      /search          # Coveo-like layer over Elasticsearch
      /auth            # JWT auth
      /models          # Postgres models / repositories
      /routes
      /utils
      /workers         # crawl runner / queue consumers
      /types
  /web                 # Next.js frontend (FSD)
    /app               # routing only
    /widgets           # about, sources, source-detail, search, sidebar
    /features          # auth, run-crawl, search-vacancies
    /entities          # session, user, source, vacancy
    /shared            # ui/, lib/ (api client)
/docker                # docker-compose + service configs
```
