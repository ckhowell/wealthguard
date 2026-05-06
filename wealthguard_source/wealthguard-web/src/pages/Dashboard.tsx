import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, Tooltip,
  XAxis, YAxis, CartesianGrid,
  AreaChart, Area, LineChart, Line, ReferenceLine, ReferenceDot,
} from 'recharts';
import {
  Wallet, Building2, Car, Bitcoin, LineChart as LineChartIcon, PieChart as PieChartIcon,
  TrendingUp, TrendingDown, AlertTriangle,
  RefreshCw, ArrowRight, Loader2, Hammer, Lightbulb, Podcast, Calendar,
  Activity, Gauge, Coins, BarChart3, Sparkles,
  MessageSquareWarning, Check, XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import Skeleton from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import SectionHeader from '../components/SectionHeader';
import { useNetWorth } from '../hooks/useNetWorth';
import { useCountUp } from '../hooks/useCountUp';
import { useAccounts } from '../queries/accounts';
import { fmtAge } from '../lib/aiCache';
import type { Holding, NetWorthSnapshot } from '../types/api';

// ============================================================================
// Types — shapes mirror the backend endpoints this page calls.
// ============================================================================
interface AccountRow {
  id: number;
  name: string;
  type: string;
  currency: string;
  current_balance: number;
  current_balance_aud: number;
  apy?: number | null;
}

interface InterestAccount { account: string; balance_aud: number; apy_pct: number; monthly_aud: number }
interface OpportunityItem { account: string; balance_aud: number; monthly_uplift_aud: number; target_apy_pct: number }
interface StakingItem { source: string; address: string; monthly_aud: number; basis: string }

interface StructuredIncome {
  nicole_monthly: number;
  interest_monthly: number;
  staking_monthly?: number;
  txn_income_monthly: number;
  total_monthly: number;
  interest_breakdown: InterestAccount[];
  staking_breakdown?: StakingItem[];
  opportunity_monthly_aud?: number;
  opportunity_items?: OpportunityItem[];
  yield_efficiency_pct?: number;
  target_apy_pct?: number;
}

interface RunwayResp {
  baseline_living: number;
  baseline_income: number;
  structured_income?: StructuredIncome;
  runway: {
    cash_aud: number;
    baseline_net_burn_per_month: number;
    runway_months_at_baseline: number | null;
    full_avg_net_burn_per_month: number;
    runway_months_at_full_avg: number | null;
  };
}

interface RunwayDelta {
  current_months: number | null;
  prior_months: number | null;
  delta_months: number | null;
  current_cash_aud: number;
  prior_cash_aud: number;
  cash_delta_aud: number;
  cause: string;
}

interface PlanSimResp {
  starting_cash: number;
  retire_month?: string | null;
  health: 'green' | 'amber' | 'red' | null;
  project_spend: Record<string, { spent_to_date: number; transaction_count: number; project_id?: number }>;
  events: { month: string; label: string; amount?: number; kind?: string }[];
  warnings: { month: string; cash: number; status: string }[];
}

interface Recommendation {
  id: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical' | string;
  title: string;
  detail?: string;
  action?: string;
  est_impact_aud_per_year?: number | null;
}

interface Episode {
  id: number;
  title: string;
  source_name?: string;
  published_at?: string;
  is_listened?: number | boolean;
}

interface MarketsSnapshot {
  fx: { pair: string; rate: number; change_pct: number }[];
  crypto: { symbol: string; price_aud: number; change_24h_pct: number; native_currency: string }[];
  updated_at: string;
}

interface NarrativeResp {
  narrative?: string;
  provider?: string;
  wealth_health_score?: number;
  // Iteration 22 cache-meta. See src/lib/aiCache.ts.
  cached?: false;
  _cached_at?: string | null;
  _age_seconds?: number;
  _stale?: boolean;
}

interface RebalanceTargets {
  real_estate_pct: number;
  cash_yielding_pct: number;
  crypto_pct: number;
  stocks_pct: number;
  other_pct: number;
}

interface ProjectionResp {
  series: { year: number; total: number; buckets: Record<string, number> }[];
  current: { net_worth: number };
  milestones?: { year: number; label: string }[];
}

// ============================================================================
// Asset-class helpers — same bucket logic used across the app.
// ============================================================================
type Bucket = 'realEstate' | 'cash' | 'crypto' | 'vehicle' | 'stock';

function bucketFor(h: Holding): Bucket | null {
  const cls = (h.asset_class || '').toLowerCase();
  if (cls === 'crypto') return 'crypto';
  if (cls === 'equity' || cls === 'etf' || cls === 'mutual_fund') return 'stock';
  if (cls === 'alternative') {
    const sym = (h.symbol || '').toUpperCase();
    if (sym.startsWith('VEHICLE')) return 'vehicle';
    return 'realEstate';
  }
  return null;
}

const ASSET_META: Record<Bucket, { label: string; color: string; icon: typeof Building2 }> = {
  realEstate: { label: 'Real Estate', color: '#00E5FF', icon: Building2 },
  cash:       { label: 'Cash',        color: '#78716c', icon: Wallet },
  crypto:     { label: 'Crypto',      color: '#44403c', icon: Bitcoin },
  vehicle:    { label: 'Vehicles',    color: '#a8a29e', icon: Car },
  stock:      { label: 'Stocks',      color: '#1c1917', icon: LineChartIcon },
};

// ============================================================================
// Formatters
// ============================================================================
const fmtAud = (v: number) =>
  (v ?? 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

const fmtAudShort = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${v < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(2)}M`;
  // $100k+ rounds to integer k for compact display.  $1k–$100k uses one decimal
  // so parts add up to the whole visually (e.g. $3.5k + $2.0k + $0.6k = $6.1k).
  if (abs >= 100_000) return `${v < 0 ? '-' : ''}$${Math.round(abs / 1000)}k`;
  if (abs >= 1_000) return `${v < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`;
  return fmtAud(v);
};

// Always-`$X.Xk` formatter — used inside multi-value rows where mixing "$4.0k"
// and "$596" reads as two different scales. e.g. cockpit income sub-line:
// "Nicole $4.0k · int $2.0k · stk $0.6k". Caller decides; fmtAudShort stays
// the default elsewhere.
const fmtAudK = (v: number) => {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 100_000) return `${sign}$${Math.round(abs / 1000)}k`;
  return `${sign}$${(abs / 1000).toFixed(1)}k`;
};

const pct = (n: number, digits = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;

// Full 4-digit year — "Dec 28" (en-AU 2-digit) is ambiguous with the 28th of
// December.  For plan milestone dates we always want "Dec 2028" / "Dec 2030".
const fmtMonthShort = (ym: string) => {
  const [y, m] = ym.split('-');
  if (!y || !m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });
};

// ============================================================================
// SurvivalCockpit — deep-surface hero that answers "am I surviving?".
//
// Shows the four cockpit KPIs (cash / income / spend / net) with count-up
// mount animation, a status-dot pulse when health is amber/red, the runway
// months + Δ-this-week indicator, yield-efficiency micro-bar, and a horizon-
// line sparkline of cash balance over the last 12mo with a 2030-12 retire
// marker.  Uses `--surface-cockpit` for the signature ink-with-cyan feel.
// ============================================================================
interface SurvivalProps {
  cashAud: number;
  cashAccountCount: number;
  runway: RunwayResp | null;
  delta: RunwayDelta | null;
  cashHistory: NetWorthSnapshot[];
  retireMonth?: string | null;
}

interface HealthScore {
  score: number;
  max: number;
  tone: 'green' | 'amber' | 'red';
  verdict: string;
  components: { key: string; label: string; points: number; max: number; detail: string }[];
}

const SurvivalCockpit = ({ cashAud, cashAccountCount, runway, delta, cashHistory, retireMonth }: SurvivalProps) => {
  const burn = runway?.runway.baseline_net_burn_per_month ?? 0;
  const months = runway?.runway.runway_months_at_baseline ?? null;
  const income = runway?.structured_income?.total_monthly ?? 0;
  const nicole = runway?.structured_income?.nicole_monthly ?? 0;
  const interest = runway?.structured_income?.interest_monthly ?? 0;
  const staking = runway?.structured_income?.staking_monthly ?? 0;
  const living = runway?.baseline_living ?? 0;
  const net = income - living;
  const yieldEff = runway?.structured_income?.yield_efficiency_pct ?? 0;
  const targetApy = runway?.structured_income?.target_apy_pct ?? 5.15;

  // Plan health score — fetched separately because it's a pure compute endpoint
  // (5-min cache, no Kimi cascade, sub-100ms round-trip). Surfaced as a
  // compact badge in the status strip so the user has one-number-to-track.
  const [healthScore, setHealthScore] = useState<HealthScore | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/intel/plan-health-score')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setHealthScore(d); })
      .catch(() => { /* silent — health score is non-critical ornament */ });
    return () => { cancelled = true; };
  }, []);

  // Count-up animations on the 4 KPIs
  const cashAnim   = useCountUp(cashAud, 500);
  const incomeAnim = useCountUp(income, 500);
  const livingAnim = useCountUp(living, 500);
  const netAnim    = useCountUp(net, 500);

  const status = useMemo(() => {
    if (burn <= 0)         return { label: 'Income covers burn', dotColor: 'bg-emerald-400', shouldPulse: false };
    if (months == null)    return { label: 'No burn detected',    dotColor: 'bg-stone-400',   shouldPulse: false };
    if (months >= 60)      return { label: 'On track',            dotColor: 'bg-emerald-400', shouldPulse: false };
    if (months >= 24)      return { label: 'Comfortable',         dotColor: 'bg-cyan-400',    shouldPulse: false };
    if (months >= 12)      return { label: 'Caution',             dotColor: 'bg-yellow-400',  shouldPulse: true };
    return { label: 'Runway tight', dotColor: 'bg-rose-400', shouldPulse: true };
  }, [burn, months]);

  // Horizon-line data — last 365d of cash balance
  const spark = useMemo(() => {
    const trimmed = cashHistory.slice(-365);
    return trimmed.map(s => ({
      date: s.snapshot_date,
      value: (s as NetWorthSnapshot & { cash_value?: number }).cash_value ?? s.net_worth,
    }));
  }, [cashHistory]);

  const retireLabel = retireMonth ? new Date(retireMonth + '-01').toLocaleDateString('en-AU', { month: 'short', year: 'numeric' }) : 'Retire 2030';

  // When delta_months is null we fall back to delta.cause, which the API
  // sometimes returns as a full sentence ("Cash dropped due to large outflow
  // on…"). That breaks the cockpit's compact one-line strip — cap at ~32
  // chars + ellipsis so the layout stays clean. Full text on hover via title.
  const deltaCauseShort = (() => {
    const c = delta?.cause;
    if (!c) return '—';
    return c.length > 32 ? `${c.slice(0, 31)}…` : c;
  })();
  const deltaLabel = delta?.delta_months != null
    ? `${delta.delta_months >= 0 ? '+' : ''}${delta.delta_months.toFixed(1)} mo this week`
    : deltaCauseShort;

  return (
    <section
      className="surface-cockpit rounded-2xl p-6 md:p-8 relative overflow-hidden"
      aria-label="Survival cockpit"
    >
      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6 md:mb-8">
        <span className="inline-flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${status.dotColor} ${status.shouldPulse ? 'animate-pulse-dot' : ''}`}
            aria-hidden="true"
          />
          <span className="font-display text-xs uppercase tracking-wider cockpit-text">{status.label}</span>
        </span>
        {months != null && (
          <span className="font-mono tabular-nums text-sm text-stone-100">
            Runway <span className="text-white">{months.toFixed(1)} mo</span>
            <span className="cockpit-muted ml-1">≈ {(months / 12).toFixed(1)} yrs</span>
          </span>
        )}
        <span
          className="font-mono tabular-nums text-xs cockpit-muted"
          title={delta?.delta_months == null ? (delta?.cause ?? undefined) : undefined}
        >
          Δ {deltaLabel}
        </span>
        {healthScore && (
          <span
            className={`font-mono tabular-nums text-xs px-2 py-0.5 rounded border ${
              healthScore.tone === 'green'
                ? 'text-emerald-400 border-emerald-600/50'
                : healthScore.tone === 'amber'
                  ? 'text-yellow-400 border-yellow-600/50'
                  : 'text-rose-400 border-rose-600/50'
            }`}
            title={`${healthScore.verdict} · ${healthScore.components.map(c => `${c.label} ${c.points.toFixed(0)}/${c.max}`).join(' · ')}`}
          >
            Score {healthScore.score.toFixed(0)}/{healthScore.max}
          </span>
        )}
        <span className="ml-auto font-display text-xs uppercase tracking-widest cockpit-muted">
          Survival Cockpit
        </span>
      </div>

      {/* 4 oversized KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <KpiCockpit
          label="Cash"
          value={fmtAudShort(cashAnim)}
          sub={`${cashAccountCount} acct${cashAccountCount === 1 ? '' : 's'}`}
        />
        <KpiCockpit
          label="Income / mo"
          value={fmtAudShort(incomeAnim)}
          sub={staking > 0
            ? `Nicole ${fmtAudK(nicole)} · int ${fmtAudK(interest)} · stk ${fmtAudK(staking)}`
            : `Nicole ${fmtAudK(nicole)} · int ${fmtAudK(interest)}`}
        />
        <KpiCockpit
          label="Spend / mo"
          value={fmtAudShort(livingAnim)}
          sub="3-mo recurring baseline"
        />
        <KpiCockpit
          label={net >= 0 ? 'Surplus / mo' : 'Net burn / mo'}
          value={`${net >= 0 ? '+' : ''}${fmtAudShort(netAnim)}`}
          sub={`12-mo avg ${fmtAudShort(-(runway?.runway.full_avg_net_burn_per_month ?? 0))}`}
          accent={net >= 0 ? 'text-emerald-400' : 'text-rose-400'}
        />
      </div>

      {/* Yield efficiency micro-bar */}
      {yieldEff > 0 && (
        <div className="mt-6 md:mt-8">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="font-display text-xs uppercase tracking-widest cockpit-muted">
              Yield efficiency
            </span>
            <span className="font-mono tabular-nums text-xs text-stone-100">
              {yieldEff.toFixed(1)}% at ≥{(targetApy * 0.9).toFixed(2)}% APY
              <span className="cockpit-muted ml-2">target {targetApy.toFixed(2)}%</span>
            </span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${yieldEff >= 80 ? 'bg-emerald-400' : yieldEff >= 50 ? 'bg-cyan-400' : 'bg-rose-400'}`}
              style={{ width: `${Math.min(100, yieldEff)}%` }}
              aria-label={`${yieldEff.toFixed(0)}% of cash earning at or near best rate`}
            />
          </div>
        </div>
      )}

      {/* Horizon-line sparkline — Recharts handles its own entrance animation
          (900ms ease-out) which actually works with variable path length.
          We let it run once on mount; disabled on reduced-motion in CSS. */}
      {spark.length >= 2 && (
        <div className="mt-6 h-20 -mx-2 relative">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={spark} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <Line
                type="monotone"
                dataKey="value"
                stroke="#00E5FF"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={true}
                animationDuration={900}
                animationEasing="ease-out"
              />
              <Tooltip
                cursor={{ stroke: 'rgba(0,229,255,0.3)' }}
                contentStyle={{ background: 'rgba(10,14,20,0.95)', border: '1px solid rgba(0,229,255,0.2)', borderRadius: 6, color: '#fff', fontSize: 11 }}
                formatter={(v: number) => [fmtAudShort(v), 'Cash']}
                labelFormatter={(l) => String(l).slice(0, 10)}
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="absolute bottom-0 right-0 font-display text-xs uppercase tracking-widest cockpit-muted flex items-center gap-1.5">
            <span className="w-px h-3 bg-stone-500" />
            {retireLabel}
          </div>
          <div className="absolute bottom-0 left-0 font-display text-xs uppercase tracking-widest cockpit-muted">
            Cash · 12mo
          </div>
        </div>
      )}
    </section>
  );
};

const KpiCockpit = ({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) => (
  <div>
    <div className="font-display text-xs uppercase tracking-widest cockpit-muted">{label}</div>
    <div className={`text-3xl md:text-5xl mt-1 tabular-nums ${accent || 'text-white'} font-mono`}>
      {value}
    </div>
    {sub && <div className="text-xs cockpit-muted mt-1.5 font-mono tabular-nums truncate">{sub}</div>}
  </div>
);

// ============================================================================
// PlanTracker — the "how's the plan tracking?" answer.
//
// Lists current project spend + next 3 events from /api/plan/simulate, plus a
// pulsing red row if the sim hit a cash-break point.  Kept largely from the
// previous Dashboard but repolished with font-display eyebrows and a pulsing
// health dot when status is amber/red.
// ============================================================================
const PlanTracker = ({ plan }: { plan: PlanSimResp | null }) => {
  const healthLabel =
    plan?.health === 'green' ? 'On track' :
    plan?.health === 'amber' ? 'Caution' :
    plan?.health === 'red'   ? 'At risk' : 'Unknown';
  const healthDot =
    plan?.health === 'green' ? 'bg-emerald-500' :
    plan?.health === 'amber' ? 'bg-yellow-500' :
    plan?.health === 'red'   ? 'bg-rose-500' : 'bg-stone-400';
  const shouldPulse = plan?.health === 'amber' || plan?.health === 'red';

  // Surface the WORST-case cash moment (deepest negative) rather than the
  // first break — seeing "first break -$16k in Aug '28" hides the real trough
  // of "-$81k in Nov '28".  If there are no breaks, fall back to the first
  // tight warning.
  const breaks = plan?.warnings?.filter(w => w.status === 'break') ?? [];
  const worstBreak = breaks.length > 0
    ? breaks.reduce((acc, w) => (w.cash < acc.cash ? w : acc), breaks[0])
    : plan?.warnings?.[0];
  const firstBreak = worstBreak;

  return (
    <section>
      <SectionHeader
        icon={Hammer}
        label="Plan tracker"
        right={
          <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase text-stone-500 dark:text-stone-400">
            <span className={`w-1.5 h-1.5 rounded-full ${healthDot} ${shouldPulse ? 'animate-pulse-dot' : ''}`} />
            {healthLabel}
          </span>
        }
      />
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 h-full">
        {!plan ? (
          <p className="text-base text-stone-500 dark:text-stone-400">Loading plan…</p>
        ) : (
          <>
            <table className="min-w-full text-base">
              <thead>
                <tr className="border-b border-stone-200 dark:border-stone-800 text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  <th className="text-left py-2">Item</th>
                  <th className="text-right py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(plan.project_spend).map(([name, info]) => (
                  <tr key={name} className="border-b border-stone-100 dark:border-stone-800/60">
                    <td className="py-2.5 text-stone-900 dark:text-stone-100 truncate pr-2">{name}</td>
                    <td className="py-2.5 text-right text-stone-500 dark:text-stone-400 tabular-nums whitespace-nowrap font-mono">
                      {fmtAudShort(info.spent_to_date)}
                      <span className="text-xs text-stone-400 ml-1">· {info.transaction_count} txns</span>
                    </td>
                  </tr>
                ))}
                {plan.events.slice(0, 3).map((e, i) => (
                  <tr key={`ev-${i}`} className="border-b border-stone-100 dark:border-stone-800/60">
                    <td className="py-2.5 text-stone-700 dark:text-stone-300 truncate pr-2">{e.label}</td>
                    <td className="py-2.5 text-right font-mono tabular-nums text-stone-500 dark:text-stone-400 whitespace-nowrap">
                      {fmtMonthShort(e.month)}
                    </td>
                  </tr>
                ))}
                {firstBreak && (() => {
                  // Reserve rose for actual break (cash goes negative). 'tight'
                  // means cash dipped low but stayed positive — that's a caution
                  // signal, not a flatline. Amber communicates "watch this"
                  // without screaming "running out".
                  const isBreak = firstBreak.status === 'break';
                  const toneCls = isBreak
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-amber-600 dark:text-amber-400';
                  return (
                    <tr className={toneCls}>
                      <td className="py-2.5">
                        <span className="flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                          {isBreak ? 'Cash runs out' : 'Cash gets tight'}
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                        {fmtMonthShort(firstBreak.month)} · {fmtAudShort(firstBreak.cash)}
                      </td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>

            <Link
              to="/plan"
              className="inline-flex items-center gap-1 text-xs text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
            >
              Open plan <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </>
        )}
      </div>
    </section>
  );
};

// ============================================================================
// ActOnToday — single-source "what should I do today?".
//
// Inlines the old TakesOnHoldings podbits CTA for consolidation and merges
// recommendations + EOFY + income opportunity into one ranked list.  Only one
// cyan CTA at the bottom (Open Advisor) — everything above is a neutral card
// with a left-border accent matching the category.
// ============================================================================
interface ActProps {
  recs: Recommendation[];
  unlistened: number;
  opportunity?: { monthly: number; items: OpportunityItem[] };
}

const ActOnToday = ({ recs, unlistened, opportunity }: ActProps) => {
  const top = [...recs]
    .sort((a, b) => (b.est_impact_aud_per_year ?? 0) - (a.est_impact_aud_per_year ?? 0))
    .slice(0, 2);

  const today = new Date();
  const y = today.getMonth() >= 5 ? today.getFullYear() + 1 : today.getFullYear();
  const eofy = new Date(y, 5, 30);
  const daysToEofy = Math.ceil((eofy.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const inEofyWindow = daysToEofy <= 70 && daysToEofy > 0;

  return (
    <section>
      <SectionHeader icon={Lightbulb} label="Act on today" />
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 space-y-3 h-full">
        {opportunity && opportunity.monthly > 0 && opportunity.items.length > 0 && (
          <Link
            to="/advisor"
            className="block border border-stone-200 dark:border-stone-800 border-l-2 border-l-emerald-500 rounded-lg p-3 hover:border-stone-300 dark:hover:border-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-mono uppercase text-stone-500 dark:text-stone-400">
                <TrendingUp className="w-3 h-3" strokeWidth={1.75} /> Income opportunity
              </div>
              <span className="text-xs font-mono tabular-nums text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                +{fmtAudShort(opportunity.monthly)}/mo
              </span>
            </div>
            <div className="text-base text-stone-900 dark:text-stone-100 mt-1">
              Move {opportunity.items.map(i => i.account.replace(' Account', '')).join(', ')} to a {opportunity.items[0].target_apy_pct}% AUD account
            </div>
          </Link>
        )}

        {inEofyWindow && (
          <Link
            to="/advisor"
            className="block border border-stone-200 dark:border-stone-800 border-l-2 border-l-cyan-500 rounded-lg p-3 hover:border-stone-300 dark:hover:border-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
          >
            <div className="flex items-center gap-1.5 text-xs font-mono uppercase text-stone-500 dark:text-stone-400">
              <Calendar className="w-3 h-3" strokeWidth={1.75} /> EOFY window
            </div>
            <div className="text-base text-stone-900 dark:text-stone-100 mt-1">
              {daysToEofy} days until 30 June — review tax moves
            </div>
          </Link>
        )}

        {unlistened > 0 && (
          <Link
            to="/podbits"
            className="block border border-stone-200 dark:border-stone-700 rounded-lg p-3 hover:border-stone-300 dark:hover:border-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
          >
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
              <Podcast className="w-3 h-3" /> New WG Analyst takes
            </div>
            <div className="text-base text-stone-900 dark:text-stone-100 mt-1">
              {unlistened} episode{unlistened === 1 ? '' : 's'} unread
            </div>
          </Link>
        )}

        {top.length === 0 ? (
          <p className="text-base text-stone-500 dark:text-stone-400">No recommendations.</p>
        ) : (
          top.map((r) => {
            // Kind-aware stat display. Green "+$X/yr" on an expenses
            // recommendation implies an opportunity — it's actually the
            // amount of over-spend, which should read as a drag (amber),
            // not a gain.  Mirror: cash recs are real yield opportunities →
            // emerald.  Default unknown kinds to a neutral stone tone.
            const impact = r.est_impact_aud_per_year ?? 0;
            let tone = 'text-stone-500 dark:text-stone-400';
            let sign = '';
            if (impact > 0) {
              if (r.kind === 'cash') {
                // only true opportunities (idle money) read positive
                tone = 'text-emerald-600 dark:text-emerald-400';
                sign = '+';
              } else if (r.kind === 'expenses' || r.kind === 'debt') {
                // cost drag — size of the problem, not a gain
                tone = 'text-amber-600 dark:text-amber-400';
                sign = '';
              } else if (r.kind === 'tax' || r.kind === 'investments') {
                // neutral — could be either direction, don't imply gain
                tone = 'text-cyan-600 dark:text-cyan-400';
                sign = '';
              }
            }
            return (
            <Link
              key={r.id}
              to="/advisor"
              className="block border border-stone-200 dark:border-stone-700 rounded-lg p-3 hover:border-stone-300 dark:hover:border-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    {r.kind}
                  </div>
                  <div className="text-base text-stone-900 dark:text-stone-100 leading-snug mt-0.5">
                    {r.title}
                  </div>
                </div>
                {impact > 0 && (
                  <span className={`text-xs font-mono tabular-nums ${tone} whitespace-nowrap`}>
                    {sign}{fmtAudShort(impact)}/yr
                  </span>
                )}
              </div>
            </Link>
            );
          })
        )}

        <Link
          to="/advisor"
          className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded mt-1"
        >
          Open Advisor <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </section>
  );
};

// ============================================================================
// WGAnalystNarrative — the Kimi / Gemini paragraph that frames today.
//
// Pulls `/api/advisor/narrative` which is already income-led per the server
// prompt.  Replaces the standalone DailyBriefing card for consolidation;
// DailyBriefing stays in the codebase but is no longer rendered here.
// ============================================================================
const WGAnalystNarrative = () => {
  const [data, setData] = useState<NarrativeResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Iteration 22: mount-load reads cache only; "Regenerate" button fires Kimi.
  const load = async (mode: 'mount' | 'fresh' = 'mount') => {
    setLoading(true);
    setErr(null);
    try {
      const qs = mode === 'fresh' ? '?force=true' : '?cache_only=true';
      const res = await fetch(`/api/advisor/narrative${qs}`);
      if (!res.ok) throw new Error(`narrative ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load narrative');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load('mount'); }, []);
  const noCache = data?.cached === false;

  return (
    <section>
      <SectionHeader
        icon={Sparkles}
        label="WG Analyst · today's note"
        right={
          <button
            type="button"
            onClick={() => load('fresh')}
            disabled={loading}
            className="text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 inline-flex items-center gap-1 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {loading ? 'Thinking' : (noCache ? 'Run analysis' : 'Regenerate')}
          </button>
        }
      />
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 h-full">
        {err ? (
          <ErrorState title="Analyst unavailable" message={err} onRetry={() => load('fresh')} />
        ) : noCache ? (
          <p className="text-base text-stone-500 dark:text-stone-400">
            No analyst note yet — click <span className="text-cyan-600 dark:text-cyan-400">Run analysis</span> to generate today's narrative. (One Kimi/Gemini call.)
          </p>
        ) : !data ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <p className="text-base text-stone-900 dark:text-stone-100 leading-relaxed">
              {data.narrative}
            </p>
            <div className="mt-3 flex items-center gap-3 text-xs font-mono uppercase tracking-wider text-stone-400 dark:text-stone-500">
              {data.provider && <span>via {data.provider}</span>}
              {data.wealth_health_score != null && (
                <span>health {data.wealth_health_score}/100</span>
              )}
              {data._age_seconds != null && (
                <span className={data._stale ? 'text-amber-500 dark:text-amber-400' : ''}>
                  · {fmtAge(data._age_seconds)}{data._stale ? ' · stale' : ''}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
};

// ============================================================================
// LiveMarkets — FX + crypto snapshot tile.
//
// Pulls `/api/dashboard/markets-snapshot`. Shows AUD/USD + AUD/JPY (since cash
// is split across Rabo AUD + Wise JPY) and the top 5 crypto prices in AUD with
// 24h change.  Colour only on the tiny trend arrow icon, never the card bg.
// ============================================================================
const LiveMarkets = () => {
  const [data, setData] = useState<MarketsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch('/api/dashboard/markets-snapshot');
      if (!res.ok) throw new Error(`markets ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load markets');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const Row = ({ label, value, changePct, dim }: { label: string; value: string; changePct: number; dim?: string }) => {
    const up = changePct >= 0;
    return (
      <div className="flex items-center justify-between py-2.5 border-b border-stone-100 dark:border-stone-800/60 last:border-b-0">
        <div className="min-w-0">
          <div className="text-base text-stone-900 dark:text-stone-100">{label}</div>
          {dim && <div className="text-xs text-stone-500 dark:text-stone-400 font-mono">{dim}</div>}
        </div>
        <div className="flex items-center gap-2 text-right">
          <div className="font-mono tabular-nums text-base text-stone-900 dark:text-stone-100">{value}</div>
          <span className={`inline-flex items-center gap-0.5 text-xs font-mono tabular-nums ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {up ? <TrendingUp className="w-3 h-3" strokeWidth={2} /> : <TrendingDown className="w-3 h-3" strokeWidth={2} />}
            {pct(changePct, 2)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <section>
      <SectionHeader
        icon={BarChart3}
        label="Live markets"
        right={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 inline-flex items-center gap-1 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
        }
      />
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5 h-full">
        {err ? (
          <ErrorState title="Markets unavailable" message={err} onRetry={load} />
        ) : !data ? (
          <Skeleton className="h-36 w-full" />
        ) : (
          <>
            {data.fx.map(r => (
              <Row
                key={r.pair}
                label={r.pair}
                value={r.rate.toFixed(r.pair.endsWith('JPY') ? 2 : 4)}
                changePct={r.change_pct}
                dim="24h · spot"
              />
            ))}
            <div className="h-1.5" />
            {data.crypto.slice(0, 5).map(c => (
              <Row
                key={c.symbol}
                label={c.symbol}
                value={fmtAudShort(c.price_aud)}
                changePct={c.change_24h_pct}
                dim="24h · AUD"
              />
            ))}
          </>
        )}
      </div>
    </section>
  );
};

// ============================================================================
// AllocationVsTarget — horizontal stacked bars vs target.
//
// Replaces the decorative donut.  Actual allocation in solid emerald/cyan/rose
// bars; target indicated by a tick above each segment so drift is obvious.
// ============================================================================
interface AllocProps {
  totals: Record<Bucket, number>;
  totalValue: number;
  targets: RebalanceTargets | null;
}

const AllocationVsTarget = ({ totals, totalValue, targets }: AllocProps) => {
  if (!targets || totalValue <= 0) {
    return (
      <section>
        <SectionHeader icon={Gauge} label="Allocation vs target" />
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 h-full">
          <Skeleton className="h-36 w-full" />
        </div>
      </section>
    );
  }

  const currentPct = {
    realEstate: (totals.realEstate / totalValue) * 100,
    cash:       (totals.cash       / totalValue) * 100,
    crypto:     (totals.crypto     / totalValue) * 100,
    stock:      (totals.stock      / totalValue) * 100,
    vehicle:    (totals.vehicle    / totalValue) * 100,
  };

  const rows = [
    { label: 'Real Estate',   cur: currentPct.realEstate, target: targets.real_estate_pct },
    { label: 'Cash-yielding', cur: currentPct.cash,       target: targets.cash_yielding_pct },
    { label: 'Crypto',        cur: currentPct.crypto,     target: targets.crypto_pct },
    { label: 'Stocks',        cur: currentPct.stock,      target: targets.stocks_pct },
    { label: 'Other',         cur: currentPct.vehicle,    target: targets.other_pct },
  ];

  return (
    <section>
      <SectionHeader
        icon={Gauge}
        label="Allocation vs target"
        right={
          <Link
            to="/rebalancer"
            className="text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
          >
            Rebalancer <ArrowRight className="w-3 h-3" />
          </Link>
        }
      />
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 h-full space-y-4">
        {rows.map(r => {
          const drift = r.cur - r.target;
          const absDrift = Math.abs(drift);
          const driftClass =
            absDrift <= 3 ? 'text-stone-500 dark:text-stone-400' :
            absDrift <= 8 ? 'text-yellow-600 dark:text-yellow-400' :
            'text-rose-600 dark:text-rose-400';
          const maxSpan = Math.max(r.cur, r.target, 40);
          return (
            <div key={r.label}>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-base text-stone-900 dark:text-stone-100">{r.label}</span>
                <span className={`font-mono tabular-nums text-sm ${driftClass}`}>
                  {r.cur.toFixed(1)}% <span className="text-stone-400 dark:text-stone-500">/ {r.target}%</span>
                </span>
              </div>
              <div
                className="relative h-2.5 bg-stone-100 dark:bg-stone-800 rounded-full"
                role="img"
                aria-label={`${r.label}: ${r.cur.toFixed(1)}% of portfolio, target ${r.target}%`}
              >
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${absDrift <= 3 ? 'bg-cyan-500' : drift > 0 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(100, (r.cur / maxSpan) * 100)}%` }}
                  aria-hidden="true"
                />
                {/* target tick */}
                <div
                  className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-stone-700 dark:bg-stone-300"
                  style={{ left: `${Math.min(100, (r.target / maxSpan) * 100)}%` }}
                  aria-hidden="true"
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

// ============================================================================
// StakingLive — ETH + SOL staking rewards, live.
//
// Pulls from `/api/crypto/staking-rewards` and `/api/crypto/solana-staking-
// rewards` directly for the per-chain APY + address bits, then sums the
// monthly AUD for the total line.  Reuses structured_income's staking_monthly
// as the canonical total so the number matches everywhere else.
// ============================================================================
interface StakingChain {
  chain: 'ETH' | 'SOL';
  address: string;
  monthly_aud: number;
  basis: string;
  apy?: number;
  staked_display?: string;
  // Validator intel (NEW — added iteration 7)
  network_apy_pct?: number;
  apy_gap_pct?: number;
  gap_annual_aud?: number;
  validator_status?: 'on_par' | 'outperforming' | 'underperforming' | 'unknown';
}

const StakingLive = ({ totalMonthly }: { totalMonthly: number }) => {
  const [chains, setChains] = useState<StakingChain[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Parallel — the two staking endpoints are independent.  Fail per-chain,
      // not all-or-nothing: if SOL errors we still surface ETH.
      const [ethRes, solRes] = await Promise.allSettled([
        fetch('/api/crypto/staking-rewards').then(r => r.ok ? r.json() : null),
        fetch('/api/crypto/solana-staking-rewards').then(r => r.ok ? r.json() : null),
      ]);
      if (cancelled) return;
      const results: StakingChain[] = [];
      if (ethRes.status === 'fulfilled' && ethRes.value && (ethRes.value.monthly_aud ?? 0) > 0) {
        const e = ethRes.value;
        results.push({
          chain: 'ETH',
          address: e.address || '',
          monthly_aud: e.monthly_aud,
          basis: e.basis || '12mo avg',
          apy: e.implied_apy_pct ?? undefined,
          staked_display: e.validators != null ? `${e.validators} validators` : (e.eth_staked != null ? `${e.eth_staked.toFixed(2)} ETH` : undefined),
          network_apy_pct: e.network_apy_pct,
          apy_gap_pct: e.apy_gap_pct,
          gap_annual_aud: e.gap_annual_aud,
          validator_status: e.validator_status,
        });
      }
      if (solRes.status === 'fulfilled' && solRes.value && (solRes.value.monthly_aud ?? 0) > 0) {
        const s = solRes.value;
        results.push({
          chain: 'SOL',
          address: s.address || '',
          monthly_aud: s.monthly_aud,
          basis: s.basis || 'epochs',
          apy: s.implied_apy_pct ?? undefined,
          staked_display: s.delegated_sol != null ? `${s.delegated_sol.toFixed(1)} SOL` : undefined,
          network_apy_pct: s.network_apy_pct,
          apy_gap_pct: s.apy_gap_pct,
          gap_annual_aud: s.gap_annual_aud,
          validator_status: s.validator_status,
        });
      }
      setChains(results);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section>
      <SectionHeader
        icon={Coins}
        label="Live staking"
        right={
          <span className="text-xs font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            +{fmtAudShort(totalMonthly)}/mo
          </span>
        }
      />
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 h-full">
        {loading ? (
          <Skeleton className="h-28 w-full" />
        ) : chains.length === 0 ? (
          <p className="text-base text-stone-500 dark:text-stone-400">No staking rewards detected.</p>
        ) : (
          <ul className="space-y-4">
            {chains.map(c => {
              const short = c.address.length > 14 ? `${c.address.slice(0, 10)}…${c.address.slice(-4)}` : c.address;
              const gap = c.apy_gap_pct;
              const underperf = c.validator_status === 'underperforming';
              const onPar = c.validator_status === 'on_par';
              return (
                <li key={`${c.chain}-${c.address}`} className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" aria-hidden="true" />
                      <span className="text-base text-stone-900 dark:text-stone-100">{c.chain} staking</span>
                      {c.apy != null && (
                        <span className="text-xs font-mono text-stone-500 dark:text-stone-400">· {c.apy.toFixed(2)}% APY</span>
                      )}
                      {gap != null && c.network_apy_pct != null && (
                        <span
                          className={`text-xs font-mono tabular-nums px-1.5 py-0.5 rounded ${
                            underperf
                              ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20'
                              : onPar
                                ? 'text-stone-500 dark:text-stone-400'
                                : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                          }`}
                          title={`Network mean ${c.network_apy_pct.toFixed(2)}%`}
                        >
                          vs net {c.network_apy_pct.toFixed(2)}% · {gap >= 0 ? '+' : ''}{gap.toFixed(2)}%
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-stone-500 dark:text-stone-400 font-mono tabular-nums mt-0.5 truncate">
                      {c.staked_display ? `${c.staked_display} · ` : ''}{short} · {c.basis}
                    </div>
                    {c.gap_annual_aud != null && c.gap_annual_aud < -100 && (
                      <div className="text-xs font-mono tabular-nums text-rose-600 dark:text-rose-400 mt-1">
                        {fmtAudShort(Math.abs(c.gap_annual_aud))}/yr left on the table at current validator
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-mono tabular-nums text-base text-stone-900 dark:text-stone-100">
                      {fmtAudShort(c.monthly_aud)}<span className="text-xs cockpit-muted ml-0.5">/mo</span>
                    </div>
                    <div className="font-mono tabular-nums text-xs text-stone-500 dark:text-stone-400">
                      {fmtAudShort(c.monthly_aud * 12)}/yr
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Link
          to="/portfolio"
          className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 mt-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
        >
          Portfolio income <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </section>
  );
};

// ============================================================================
// TrajectoryChart — 180d actual + 15yr projection in one view.
//
// Combines the old standalone "NW 180d" area chart and the Vision page's
// projection into a single narrative: where you've been, where you're headed,
// with retirement marker at 2030-12 and plan-break indicator if the sim shows
// one.  X-axis is in years from today for the projection, days for the actual
// series — blended by plotting both against a common "years-from-start" axis.
// ============================================================================
interface TrajectoryProps {
  history: NetWorthSnapshot[];
  projection: ProjectionResp | null;
}

const TrajectoryChart = ({ history, projection }: TrajectoryProps) => {
  const data = useMemo(() => {
    // Actual: last 180 days of NW history, keyed by months-from-today (negative)
    const today = new Date();
    const actual = history.slice(-180).map(h => {
      const d = new Date(h.snapshot_date);
      const months = (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
      return { x: parseFloat(months.toFixed(2)), actual: h.net_worth, projected: null as number | null };
    });
    // Projection: years converted to months-from-today (positive)
    const proj = projection?.series?.map(p => ({
      x: p.year * 12,
      actual: null as number | null,
      projected: p.total,
    })) ?? [];
    const combined = [...actual, ...proj].sort((a, b) => a.x - b.x);
    return combined;
  }, [history, projection]);

  const delta = useMemo(() => {
    if (history.length < 2) return null;
    const a = history[0].net_worth;
    const b = history[history.length - 1].net_worth;
    return ((b - a) / a) * 100;
  }, [history]);

  const hasData = data.length >= 2;

  // Retire marker = +56 months (~2030-12 from 2026-04)
  const retireMonths = 56;

  return (
    <section>
      <SectionHeader
        icon={LineChartIcon}
        label="Net-worth trajectory · 180d + 15yr"
        right={delta != null ? (
          <span className={`text-xs font-mono tabular-nums ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {pct(delta, 2)} · 180d
          </span>
        ) : undefined}
      />
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6">
        <div className="h-80">
          {!hasData ? (
            <div className="flex items-center justify-center h-full text-xs text-stone-500 dark:text-stone-400">
              Not enough data yet — snapshots accumulate daily.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                <defs>
                  <linearGradient id="trajActual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00E5FF" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#00E5FF" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="trajProj" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#32D74B" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#32D74B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-stone-200 dark:text-stone-800" />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v) => v === 0 ? 'Now' : v < 0 ? `${Math.round(v)}mo` : `+${Math.round(v / 12)}yr`}
                  tick={{ fontSize: 10, fill: 'currentColor' }}
                  className="text-stone-500 dark:text-stone-400"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'currentColor' }}
                  className="text-stone-500 dark:text-stone-400"
                  tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`}
                />
                <Tooltip
                  contentStyle={{ background: 'rgba(28,25,23,0.95)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12 }}
                  formatter={(v: number | null) => v != null ? [fmtAudShort(v), 'NW'] : ['—', '']}
                  labelFormatter={(x: number) => x === 0 ? 'Now' : x < 0 ? `${Math.round(x)} months ago` : `+${(x / 12).toFixed(1)} yrs`}
                />
                <Area
                  type="monotone"
                  dataKey="actual"
                  stroke="#00E5FF"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#trajActual)"
                  connectNulls
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="projected"
                  stroke="#32D74B"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  fillOpacity={1}
                  fill="url(#trajProj)"
                  connectNulls
                  isAnimationActive={false}
                />
                <ReferenceLine x={0} stroke="currentColor" className="text-stone-400 dark:text-stone-600" strokeDasharray="2 2" label={{ value: 'Now', fontSize: 10, fill: 'currentColor', position: 'top' }} />
                <ReferenceLine x={retireMonths} stroke="#00E5FF" strokeDasharray="4 2" label={{ value: 'Retire 2030', fontSize: 10, fill: '#00E5FF', position: 'insideTop' }} />
                <ReferenceDot x={0} y={projection?.current?.net_worth ?? 0} r={4} fill="#00E5FF" stroke="#000" strokeWidth={1} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  );
};

// ============================================================================
// PositionMovers — kept from the old Dashboard, moved below fold.
// ============================================================================
const PositionMovers = ({ holdings }: { holdings: Holding[] }) => {
  const withPnl = holdings
    .filter(h => (h.cost_aud || 0) > 0)
    .map(h => {
      const value = h.value_aud || 0;
      const cost = h.cost_aud || 0;
      const pnlAud = value - cost;
      const pnlPct = cost > 0 ? (pnlAud / cost) * 100 : 0;
      return { h, pnlAud, pnlPct };
    });

  const topPct    = [...withPnl].sort((a, b) => b.pnlPct - a.pnlPct)[0];
  const bottomPct = [...withPnl].sort((a, b) => a.pnlPct - b.pnlPct)[0];
  const topDollar = [...withPnl].sort((a, b) => b.pnlAud - a.pnlAud)[0];

  if (!withPnl.length) return null;

  return (
    <section>
      <SectionHeader icon={Activity} label="Position movers · P&L since entry" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MoverTile title="Biggest % gainer" item={topPct}    mode="pct" />
        <MoverTile title="Biggest $ gainer" item={topDollar} mode="aud" />
        <MoverTile title="Biggest laggard"  item={bottomPct} mode="pct" />
      </div>
    </section>
  );
};

const MoverTile = ({ title, item, mode }: { title: string; item: { h: Holding; pnlAud: number; pnlPct: number } | undefined; mode: 'pct' | 'aud' }) => {
  if (!item) return null;
  const signCls = item.pnlAud >= 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-rose-600 dark:text-rose-400';
  const main = mode === 'pct' ? pct(item.pnlPct) : `${item.pnlAud >= 0 ? '+' : ''}${fmtAudShort(item.pnlAud)}`;
  const other = mode === 'pct' ? `${item.pnlAud >= 0 ? '+' : ''}${fmtAudShort(item.pnlAud)}` : pct(item.pnlPct);
  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5">
      <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">{title}</div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base text-stone-900 dark:text-stone-100 truncate">
            {item.h.asset_name || item.h.symbol}
          </div>
          <div className="text-xs text-stone-500 dark:text-stone-400 tabular-nums font-mono">
            {fmtAudShort(item.h.value_aud || 0)} value
          </div>
        </div>
        <div className="text-right">
          <div className={`text-2xl tabular-nums font-mono ${signCls}`}>
            {main}
          </div>
          <div className="text-xs font-mono tabular-nums text-stone-500 dark:text-stone-400">
            {other}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// TopHoldings — condensed 5-row list with Portfolio deep-link.
// ============================================================================
const TopHoldings = ({ holdings, totalValue }: { holdings: Holding[]; totalValue: number }) => (
  <section>
    <SectionHeader
      icon={PieChartIcon}
      label="Top holdings · top 5 by value"
      right={
        <Link
          to="/portfolio"
          className="flex items-center gap-1 text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
        >
          All holdings <ArrowRight className="w-3 h-3" />
        </Link>
      }
    />
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6">
      <div className="overflow-x-auto">
        <table className="min-w-full text-base">
          <thead>
            <tr className="border-b border-stone-200 dark:border-stone-800 text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
              <th className="text-left py-2">Asset</th>
              <th className="text-left py-2">Type</th>
              <th className="text-right py-2">Value</th>
              <th className="text-right py-2">P&amp;L</th>
              <th className="text-right py-2">% port</th>
            </tr>
          </thead>
          <tbody>
            {[...holdings]
              .sort((a, b) => (b.value_aud || 0) - (a.value_aud || 0))
              .slice(0, 5)
              .map((h) => {
                const bucket = bucketFor(h);
                const meta = bucket ? ASSET_META[bucket] : null;
                const value = h.value_aud || 0;
                const cost = h.cost_aud || 0;
                const pnlAud = cost > 0 ? value - cost : 0;
                const pnlPct = cost > 0 ? (pnlAud / cost) * 100 : 0;
                const pnlCls = pnlAud >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
                return (
                  <tr key={h.id} className="border-b border-stone-100 dark:border-stone-800/60 hover:bg-stone-50 dark:hover:bg-stone-800/30">
                    <td className="py-2.5 text-stone-900 dark:text-stone-100">{h.asset_name || h.symbol}</td>
                    <td className="py-2.5 text-stone-500 dark:text-stone-400">{meta?.label ?? h.asset_class}</td>
                    <td className="py-2.5 text-right text-stone-900 dark:text-stone-100 tabular-nums font-mono">{fmtAud(value)}</td>
                    <td className={`py-2.5 text-right tabular-nums font-mono ${pnlCls}`}>
                      {cost > 0 ? (
                        <span>
                          {pnlAud >= 0 ? '+' : ''}{fmtAudShort(pnlAud)}
                          <span className="text-xs ml-1 opacity-70">({pct(pnlPct, 0)})</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2.5 text-right text-stone-500 dark:text-stone-400 tabular-nums font-mono">
                      {totalValue > 0 ? `${((value / totalValue) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  </section>
);

// ============================================================================
// Dashboard — root component, orchestrates data fetches + layout.
// ============================================================================
const Dashboard = () => {
  const nw = useNetWorth();
  // Accounts now come from the React Query cache. A mutation in Portfolio
  // (`useUpdateAccount`) invalidates this key and the cockpit cash KPI
  // refreshes automatically — that's the cross-page live-update behaviour.
  // The remainder of the dashboard's data still flows through `load()` below
  // until those queries are migrated in a follow-up iteration.
  const { data: accountsData = [] } = useAccounts();
  const accounts: AccountRow[] = accountsData as unknown as AccountRow[];
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [history, setHistory] = useState<NetWorthSnapshot[]>([]);
  const [runway, setRunway] = useState<RunwayResp | null>(null);
  const [delta, setDelta]   = useState<RunwayDelta | null>(null);
  const [plan, setPlan] = useState<PlanSimResp | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [unlistened, setUnlistened] = useState(0);
  const [targets, setTargets] = useState<RebalanceTargets | null>(null);
  const [projection, setProjection] = useState<ProjectionResp | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [hRes, nRes, rRes, dRes, pRes, recRes, epRes, tRes, prjRes] = await Promise.all([
        fetch('/api/holdings'),
        fetch('/api/net-worth/history?days=365'),
        fetch('/api/advisor/runway?months_back=12&living_window=3'),
        fetch('/api/runway/delta?days=7'),
        fetch('/api/plan/simulate'),
        fetch('/api/advisor/recommendations'),
        fetch('/api/podbits/episodes?limit=50'),
        fetch('/api/rebalance/targets'),
        fetch('/api/vision/projection'),
      ]);
      if (!hRes.ok) throw new Error(`Holdings ${hRes.status}`);
      setHoldings(await hRes.json());
      setHistory(nRes.ok ? await nRes.json() : []);
      setRunway(rRes.ok ? await rRes.json() : null);
      setDelta(dRes.ok ? await dRes.json() : null);
      setPlan(pRes.ok ? await pRes.json() : null);
      if (recRes.ok) {
        const rdata = await recRes.json();
        setRecs(Array.isArray(rdata) ? rdata : (rdata.recommendations || []));
      }
      if (epRes.ok) {
        const ed = await epRes.json();
        const eps: Episode[] = ed.episodes || [];
        setUnlistened(eps.filter(e => !e.is_listened).length);
      }
      setTargets(tRes.ok ? await tRes.json() : null);
      setProjection(prjRes.ok ? await prjRes.json() : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const totals: Record<Bucket, number> = { realEstate: 0, cash: 0, crypto: 0, vehicle: 0, stock: 0 };
  for (const h of holdings) {
    const b = bucketFor(h);
    if (b) totals[b] += h.value_aud || 0;
  }
  const cashAccounts = accounts.filter(a => a.type === 'savings' || a.type === 'checking');
  totals.cash = cashAccounts.reduce((s, a) => s + (a.current_balance_aud || 0), 0);
  const totalValue = totals.realEstate + totals.cash + totals.crypto + totals.vehicle + totals.stock;

  const staking = runway?.structured_income?.staking_monthly ?? 0;

  return (
    <div className="space-y-6">
      {error && <ErrorState title="Couldn't load dashboard data" message={error} onRetry={load} />}

      {/* Header strip */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
          {nw.lastUpdated ? `Updated ${new Date(nw.lastUpdated).toLocaleString()}` : 'Loading…'}
        </p>
        <button
          type="button"
          onClick={() => { load(); nw.refresh(); }}
          disabled={isLoading || nw.isLoading}
          className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
        >
          {isLoading || nw.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      {/* 1. Survival Cockpit (hero) */}
      {isLoading && holdings.length === 0 ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : (
        <SurvivalCockpit
          cashAud={totals.cash}
          cashAccountCount={cashAccounts.length}
          runway={runway}
          delta={delta}
          cashHistory={history}
          retireMonth={plan?.retire_month ?? '2030-12'}
        />
      )}

      {/* 1b. Standing rebuke ribbon — self-hides when empty. */}
      <RebukeRibbon />

      {/* 2. Plan Tracker | Act on Today */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PlanTracker plan={plan} />
        <ActOnToday
          recs={recs}
          unlistened={unlistened}
          opportunity={runway?.structured_income?.opportunity_monthly_aud ? {
            monthly: runway.structured_income.opportunity_monthly_aud,
            items: runway.structured_income.opportunity_items ?? [],
          } : undefined}
        />
      </div>

      {/* 3. Analyst narrative | Live Markets */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <WGAnalystNarrative />
        <LiveMarkets />
      </div>

      {/* 4. Allocation vs Target | Staking Live */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AllocationVsTarget totals={totals} totalValue={totalValue} targets={targets} />
        <StakingLive totalMonthly={staking} />
      </div>

      {/* 5. Trajectory — 180d + 15yr */}
      <TrajectoryChart history={history} projection={projection} />

      {/* 6. Position Movers */}
      <PositionMovers holdings={holdings} />

      {/* 7. Top Holdings */}
      <TopHoldings holdings={holdings} totalValue={totalValue} />
    </div>
  );
};

// ============================================================================
// RebukeRibbon — standing accountability memo from the AI financial advisor.
//
// Pulls /api/intel/rebuke, renders ONE compact row per unresolved opportunity
// flagged >=7 days ago. Voice is a senior fiduciary advisor (not a contrarian),
// embedded in the server-side Kimi prompt. Each row shows:
//   • severity dot (cyan < 14d · yellow 14-27d · rose 28+d)
//   • Kimi one-sentence rebuke (primary)
//   • dollar bleed stat ($X/mo + $total already foregone)
//   • quick action link
//   • Mark acted / Not applicable (with reason) buttons
//
// Self-hides when the API returns empty rebukes[]. No scream — it's a calm
// standing memo below the SurvivalCockpit.
// ============================================================================
interface RebukeItem {
  source_kind: string;
  source_ref: string;
  title: string;
  opportunity_aud_per_mo: number;
  opportunity_aud_total_wasted: number;
  days_since_flagged: number;
  severity: 'attention' | 'warning' | 'critical';
  rebuke: string;
  action_link: string;
  action_label: string;
}
interface RebukeResp {
  rebukes: RebukeItem[];
  total_monthly_bleed: number;
  as_of: string;
}

const severityClasses = (s: RebukeItem['severity']) => {
  switch (s) {
    case 'critical': return { border: 'border-l-rose-500',  dot: 'bg-rose-500'    };
    case 'warning':  return { border: 'border-l-yellow-500',dot: 'bg-yellow-500'  };
    case 'attention':
    default:         return { border: 'border-l-cyan-500',  dot: 'bg-cyan-500'    };
  }
};

const RebukeRibbon = () => {
  const [data, setData] = useState<RebukeResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);   // source_ref currently asking for reason
  const [reasonText, setReasonText] = useState<string>('');

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch('/api/intel/rebuke');
      if (!r.ok) throw new Error(`rebuke ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const dismiss = async (it: RebukeItem, reason: string) => {
    const key = `${it.source_kind}|${it.source_ref}`;
    setDismissing(key);
    try {
      await fetch('/api/intel/rebuke/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_kind: it.source_kind,
          source_ref: it.source_ref,
          reason,
        }),
      });
      // Optimistic: filter out locally
      setData((prev) => prev ? {
        ...prev,
        rebukes: prev.rebukes.filter(r => !(r.source_kind === it.source_kind && r.source_ref === it.source_ref)),
        total_monthly_bleed: prev.rebukes
          .filter(r => !(r.source_kind === it.source_kind && r.source_ref === it.source_ref))
          .reduce((s, r) => s + r.opportunity_aud_per_mo, 0),
      } : prev);
      setReasoning(null);
      setReasonText('');
    } finally {
      setDismissing(null);
    }
  };

  // Self-hide: loading first-time is fine, but if nothing to rebuke, render nothing.
  if (err) {
    // Silent failure — rebuke is non-critical. Log only.
    // eslint-disable-next-line no-console
    console.warn('[RebukeRibbon] failed:', err);
    return null;
  }
  if (!loading && (!data || data.rebukes.length === 0)) return null;

  return (
    <section
      className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5"
      aria-label="Standing advisor memo"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
          <MessageSquareWarning className="w-3.5 h-3.5 text-stone-600 dark:text-stone-300" />
          Your advisor
          {data && data.rebukes.length > 0 && (
            <span className="text-stone-500 dark:text-stone-400">
              · {data.rebukes.length} item{data.rebukes.length === 1 ? '' : 's'} unresolved
              {data.total_monthly_bleed > 0 && (
                <> · <span className="text-rose-600 dark:text-rose-400">${Math.round(data.total_monthly_bleed).toLocaleString()}/mo bleed</span></>
              )}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          aria-label="Refresh rebukes"
          className="text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 inline-flex items-center gap-1 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {loading && !data ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <ul className="space-y-2">
          {data?.rebukes.map((it) => {
            const cls = severityClasses(it.severity);
            const key = `${it.source_kind}|${it.source_ref}`;
            const isDismissing = dismissing === key;
            const askingReason = reasoning === key;
            return (
              <li
                key={key}
                className={`border border-stone-200 dark:border-stone-800 border-l-2 ${cls.border} rounded-lg p-3`}
              >
                <div className="flex items-start gap-3">
                  <span className={`w-2 h-2 rounded-full ${cls.dot} mt-2 flex-shrink-0`} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="text-base text-stone-900 dark:text-stone-100 leading-snug">
                      {it.rebuke}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      <span className="tabular-nums">{it.days_since_flagged}d flagged</span>
                      <span className="tabular-nums text-rose-600 dark:text-rose-400">
                        ${Math.round(it.opportunity_aud_per_mo).toLocaleString()}/mo bleed
                      </span>
                      {it.opportunity_aud_total_wasted > 0 && (
                        <span className="tabular-nums">
                          ${Math.round(it.opportunity_aud_total_wasted).toLocaleString()} foregone
                        </span>
                      )}
                    </div>

                    {askingReason ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={reasonText}
                          onChange={(e) => setReasonText(e.target.value)}
                          placeholder="Why isn't this applicable?"
                          className="flex-1 min-w-[180px] px-3 py-1.5 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => dismiss(it, reasonText || 'not-applicable')}
                          disabled={isDismissing}
                          className="text-xs font-mono uppercase tracking-wider px-2 py-1 bg-stone-800 dark:bg-stone-700 text-white rounded hover:bg-stone-700 dark:hover:bg-stone-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
                        >
                          Dismiss
                        </button>
                        <button
                          type="button"
                          onClick={() => { setReasoning(null); setReasonText(''); }}
                          className="text-xs font-mono uppercase tracking-wider text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <Link
                          to={it.action_link}
                          className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
                        >
                          {it.action_label} <ArrowRight className="w-3 h-3" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => dismiss(it, 'acted')}
                          disabled={isDismissing}
                          aria-label="Mark acted"
                          className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wider text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 rounded"
                        >
                          <Check className="w-3 h-3" /> Mark acted
                        </button>
                        <button
                          type="button"
                          onClick={() => { setReasoning(key); setReasonText(''); }}
                          disabled={isDismissing}
                          aria-label="Not applicable"
                          className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wider text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
                        >
                          <XCircle className="w-3 h-3" /> Not applicable
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default Dashboard;
