---
type: project
created: 2026-04-25
status: active
tags: [project, personal]
---

# WealthGuard — project notes for Claude

## Table of Contents

- [[#Mission (binding)]]
- [[#The people + the plan]]
- [[#Stack]]
- [[#Design system — WattVision (binding, already implemented)]]
- [[#Frontend patterns (binding)]]
- [[#Data model highlights]]
- [[#Per-page plan (current state — 2026-04-24)]]
- [[#Operating rules]]


## Mission (binding)
**WealthGuard exists to make sure Christopher & Nicole survive.** They are in drawdown mode and the app's job is to answer three questions every day:
1. Am I still surviving? (cash, burn, runway)
2. How's the plan tracking? (Acacia → Lind → 2030 Tasmania retirement)
3. What should I act on today?

Everything is judged against that lens. If a page / feature / metric doesn't help answer those three questions, it is decoration and should be considered for removal.

## The people + the plan
- **Christopher & Nicole Howell**, Australian. Christopher not working; **Nicole earns $4,000 AUD/mo**.
- **Cash** ~$580k AUD (most in Rabobank PremiumSaver accounts @ 5.5% APY — two accounts, ~$432k combined, yielding ~$1,982/mo interest). Plus ~$148k in a Wise JPY account at 0% (an "income opportunity" — moving it to a 5.15%+ AUD account would add ~$678/mo).
- **Net worth** ~$3.8M AUD, **zero debt**.
- **Crypto** (cost-basis corrected this session): BTC 3.05 @ $40k avg, ETH 64 @ $2,250 avg, SOL 270 @ $30 avg (ADA swap), XRP 2,303 @ $1, SUI 901 @ $7.14 (only one underwater). Overall crypto ~2.14x cost. 64 ETH staked (32 Figment + 32 Allnodes). Not planning to sell crypto before 2030, so no CGT optimisation needed.
- **Plan:** complete **18 Acacia Dr (Ansons Bay, Tasmania)** reno ($10k remaining) → sell ~$450k target 2026/27 → fund new build at **27 Lind Ave, Southport QLD** ($700k build cost, target sale $2.4M in 2028-12) → retire to Ansons Bay **2030-12**.
- Retirement property = Ansons Bay. Any borrowing must be cashflow-positive from day one.

## Stack
- Backend: **FastAPI** + **SQLite** at `wealthguard_source/wealthguard_api.py`, DB at `wealthguard_source/wealthguard.db` (port 8000).
- Frontend: **React + Vite + Tailwind v4** at `wealthguard_source/wealthguard-web` (port 5174).
- Routing: React Router. State: hooks + `usePersistentState` for local-only data.
- LLM providers: **Kimi K2.6** (default advisor/podbits, temp=1, max_tokens 6000), **Gemini 2.5 Flash** (PDF/audio transcription fallback), **Qwen + OpenAI** as further fallbacks.

## Design system — WattVision (binding, already implemented)
- **Font stack:** `Inter` (body) + **`Space Grotesk` (display headings / `.font-display` / cockpit eyebrows)** + **`Geist Mono` for all numerals / `.tabular-nums` / eyebrow labels / `.font-mono`**. Geist Mono is locked — mandatory for every figure on the site. Space Grotesk was added during the Dashboard rethink (2026-04) as the display-only voice, never for body copy.
- **Dashboard cockpit surface:** `--surface-cockpit` token — deep ink `#0a0e14` in dark / `#0b1220` in light, with a subtle `--cockpit-gradient` cyan wash. ONLY the `SurvivalCockpit` hero uses this surface; everything else is the normal `bg-white dark:bg-stone-900` card. Utility class `.surface-cockpit`.
- **Accent:** `#00E5FF` (WattVision neon cyan). Single brand accent — use sparingly.
- **Semantic:** `#32D74B` lime (positive), `#FF453A` red (alert), yellow-500 for caution tier only.
- **Dark:** bg `#121212`, surface `#1E1E1E`, border `#2C2C2E`, text `#FFFFFF` / muted `#98989D`.
- **Light:** white surface on stone-50 bg, border stone-200. Cyan accent tuned to `#06b6d4` (cyan-500) for readability.
- **Corners:** 16px cards (`rounded-2xl`), 8px buttons/chips.
- **Typography rules** live in `src/index.css`:
  - h1/h2/h3/h4 = 600 weight, -0.02em tracking
  - h1 override = 700 weight, -0.03em
  - text-3xl = 700 bold, -0.02em (KPIs)
  - text-xl/2xl = 600
  - **text-base / text-sm / text-lg = 300 (light) — reading prose is intentionally thin**
  - `.uppercase.text-xs` and `.uppercase.text-sm` = 600 mono (eyebrow labels)
- **No coloured cards with coloured text** — status chips only (text-xs, px-1.5/px-2, py-0.5) may use same-hue bg+text. Everything larger uses neutral card + coloured left-border accent (`border-l-2 border-l-{accent}-500`).
- **Body copy contrast:** `text-stone-900 dark:text-stone-100` for primary reading text, `text-stone-700 dark:text-stone-300` for secondary, never `text-stone-600 dark:text-stone-400` for reading.

## Frontend patterns (binding)
- **`SectionHeader` component** (`src/components/SectionHeader.tsx`) — icon + mono uppercase eyebrow label + optional right slot. Use this for every card section header. Never use inline `<h3 className="font-semibold">` for sections.
- **`useIncome` hook** (`src/hooks/useIncome.ts`) — pulls `/api/advisor/runway`, returns `{ total_monthly, nicole_monthly, interest_monthly, net_surplus_per_month, opportunity_monthly_aud, ... }`. Use on any page that needs income context.
- **App shell header chip** (`App.tsx` `NetWorthHeader`) — shows `IN +$X/mo · NET +$Y/mo` on every page automatically.
- **Survival Pulse KPI tile pattern** (`Dashboard.tsx` `KpiLarge`) — eyebrow (text-xs mono uppercase) + big value (text-3xl bold mono) + sub (text-xs muted).
- **Tables:** `min-w-full text-base`. thead with `text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400`. tbody `border-b border-stone-100 dark:border-stone-800/60`, td `py-2.5`.

## Data model highlights
- `wealth_plan` has a single row with columns incl. `nicole_income_monthly` (=4000), plus Acacia + Lind + retirement params.
- `accounts.apy` feeds dynamic interest-income calc in `/api/advisor/runway`.
- Crypto `holdings.cost_basis_per_share` is AUD-denominated (cost_basis_currency='AUD'); current_price is USD for crypto.
- `transactions.project_id` tags reno/build spend. `transactions.category='Investment'` excludes from living burn.
- **Non-expense category rule (binding, 2026-04-25):** `transactions.category IN ('Investment', 'Transfers')` must be excluded from EVERY money_out / expense aggregation, chart, and recommendation. These are asset moves (ETF buys, internal transfers), not consumption. User decision: "investment expenditure should be limited to an asset in portfolio, not shown on Expenses." Enforced in: `_money_out_for_period`, `_rule_top_movers` (advisor_engine.py), `/api/expenses/*` (summary, monthly, by-category, by-merchant, daily, weekday, category-trend, insights), `/api/advisor/runway.baseline_living`, `/api/intel/spending-forecast`. Any new expense endpoint MUST compose the same filter: `AND (category IS NULL OR category NOT IN ('Investment', 'Transfers'))`.
- `/api/advisor/runway.structured_income` is the canonical income source: `{ nicole_monthly, interest_monthly, txn_income_monthly, total_monthly, interest_breakdown[], opportunity_monthly_aud, opportunity_items[] }`.
- `rebuke_log` — accountability-layer table powering the Dashboard RebukeRibbon. One row per `(source_kind, source_ref)` pair; tracks `first_flagged` / `last_rebuked` / `dismissed_at+reason` / `acted_at`. `/api/intel/rebuke` upserts from Rate Watcher + Project Forecaster + Advisor recs, surfaces items ≥7 days old through a Kimi "senior fiduciary advisor" prompt (NOT a contrarian — deliberate voice choice; see the tone anchors in `_rebuke_kimi_voice`). Dismissible via `POST /api/intel/rebuke/dismiss`. SQLite journal_mode = WAL since this iteration (writes during Kimi-slow paths were deadlocking readers).

## Per-page plan (current state — 2026-04-24)
See `~/.claude/plans/can-we-just-use-kind-cat.md` for full detail. Phase C = income surfacing, Phase A = Rebalancer rebuild.

**✅ Done:**
- Dashboard (Survival Pulse + Plan tracker + Act on today + Takes + Briefing)
- CashFlow (full rewrite, real income composition)

**⏳ Phase C remaining:**
- Portfolio — add monthly yield KPI + per-account $/mo
- ExpenseAnalysis — Net cashflow KPI, % of income per category, coverage ratio
- Plan — income line on trajectory chart, Nicole/APY sliders
- Projects — "months of income to complete" on each project
- Budgets — income header + % of income column
- Transactions — visual highlight on income rows
- Advisor — server-side narrative prompt revised to lead with income
- Performance — income contribution to return line

**🔨 Phase A (after C):** Rebalancer rebuild — drawdown-mode allocation, not growth-mode.

**Candidate cuts (pending user approval):** Vision 3D page (fluff), Goals page (duplicates Plan + Projects).

## Operating rules
- If I'm running unattended, pick the sensible default, **document the decision** in a status doc, and continue. Never stop on a judgment call; note it so the user can reverse.
- Every page edit: verify TSC compile clean (ignore pre-existing Recharts `Formatter<>` and unused-import warnings) + API `:8000` + web `:5174` both return 200 before moving to the next page.
- Never commit, push, or touch git state unless explicitly asked.
- Never rewrite multiple pages in one edit — one page at a time, verify, next.
- Icons: **lucide-react** (closest web match to SF Symbols for stroke rhythm). Stroke width 1.75 for card header icons, 1.5 for nav icons, default for content icons.
- Crypto cost basis in DB is AUD. When user mentions prices, they're AUD unless stated.
- If asked about tax (CGT etc.) on crypto, remember: user isn't selling pre-2030, so keep guidance at "note for later" not "act now".
