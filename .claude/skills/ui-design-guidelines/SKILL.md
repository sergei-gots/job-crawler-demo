---
name: ui-design-guidelines
description: Use when writing or editing apps/web UI code (pages, widgets, features, shared/ui components, Tailwind classes, colors, typography) in this repo — covers layout, card usage, design tokens, typography hierarchy, button color hierarchy, links, dashes, log coloring, and destructive-action styling conventions. Triggers whenever touching JSX/TSX under apps/web or app/globals.css.
---

# UI Design Guidelines

Reference screenshots live in `.claude/.design-samples/` (git-ignored, local-only).
Use those samples as the default visual language. Introduce new patterns only when the workflow
requires them.

- **Application pages should not use centered layouts.** Page content is left-positioned with
  breathing-room padding (`items-start justify-start p-8 md:p-16` for full-page forms like
  login/register; `justify-start p-4 md:p-8` for the main content area next to the sidebar) — this
  is the current choice for login/register too. Standalone marketing/auth screens may use centered
  layouts if explicitly designed that way (e.g. a future landing page) — this isn't a blanket ban,
  just the default for everything we've built so far. Content width is also single-column
  `max-w-3xl` everywhere so far (`max-w-lg` for About) — the Search page (Increment 3b) is a
  deliberate, scoped exception: a wider container with a facet panel beside the results list,
  because a faceted-search UI genuinely needs two columns, not a signal to start widening other
  pages. See `.claude/features/03_FEATURE_CRAWL_SEARCH_SEPARATION.md`'s Phase 3b decisions.
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
- **Data-wiping admin actions ("Clear cache", "Clear search data", "Clear data") use
  `variant="secondary"` (same fill/weight as every other secondary button — not the unused
  `destructive` variant, and not de-emphasized via icon-only the way item-level Delete is) plus
  `text-destructive` on the label, so the warning reads through text color alone. This is a
  deliberate exception to the earlier "de-emphasize destructive actions" call (icon-only Delete
  on a single Crawler Job, pre-Increment-3a) — these actions are more consequential (wipe the
  *entire* shared Redis cache or Elasticsearch corpus, or one source's full crawl history, not
  one item a user owns), so they warrant a clearer visual warning, not less. All three pair the
  color with a `window.confirm()` dialog before acting — the color signals severity, the dialog
  is what actually gates the action. `--destructive` itself (`app/globals.css`) was darkened from
  the shadcn default (`oklch(0.577 0.245 27.325)` → `oklch(0.45 0.19 27.325)`, light theme only)
  after visual review — the default read as too bright/alarming for a button label; the darker
  value also applies to the `CrawlLog` `ERROR` color above, sharing one token rather than adding
  a second red.
- **`StatusBadge` (`shared/ui/status-badge.tsx`) appends a status icon, not just color.**
  `COMPLETED` → ✅, `STOPPED` → ⛔ (the "no entry" road sign — Russian slang "кирпич"/"brick" for
  this sign, not a literal masonry brick), `FAILED` → ❌; `PENDING` gets no icon (nothing has happened
  yet). `RUNNING` gets an animated spinner (`animate-spin`, a small current-color ring) instead
  of a static emoji, since it's the one status that's genuinely still in progress — a still emoji
  would misrepresent that. Extend `STATUS_ICONS` (not a parallel lookup) for any future status.
