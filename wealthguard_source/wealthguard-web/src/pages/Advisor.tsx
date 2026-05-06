import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  Lightbulb, RefreshCw, Sparkles, Wallet, Receipt, TrendingDown,
  Coins, Scale, Target, Heart, ChevronRight, ExternalLink,
  CheckCircle2, ArrowRight, Clock, Calculator, Zap, Loader2,
  Mail, Copy, X as XIcon, Check,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import Skeleton from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import { type CacheMeta, fmtAge } from '../lib/aiCache';

const fmtAud = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : `${v.toFixed(1)}%`;

interface Recommendation {
  id: string;
  kind: 'cash' | 'expenses' | 'investments' | 'tax' | 'debt' | 'goals' | 'net_worth';
  severity: 'low' | 'med' | 'high';
  title: string;
  detail: string;
  evidence: string;
  action: string;
  est_impact_aud_per_year: number | null;
  links: string[];
}
interface Recs {
  generated_at: string;
  wealth_health_score: number;
  kpis: {
    net_worth_aud: number;
    cash_aud: number;
    debt_aud: number;
    monthly_income_avg_aud: number;
    monthly_expenses_avg_aud: number;
    savings_rate_pct: number;
    runway_months: number | null;
    debt_to_asset_pct: number;
  };
  recommendations: Recommendation[];
}
interface Narrative {
  narrative: string | null;
  wealth_health_score?: number;
  reason?: string;
}

interface RunwayRow { month: string; income: number; invest: number; living: number; project_spend: number; net_living: number; }
interface RunwayStructuredIncome {
  total_monthly?: number;
  nicole_monthly?: number;
  interest_monthly?: number;
  staking_monthly?: number;
}
interface RunwayResp {
  series: RunwayRow[];
  baseline_income: number;
  baseline_living: number;
  structured_income?: RunwayStructuredIncome;
  runway: {
    cash_aud: number;
    baseline_net_burn_per_month: number;
    full_avg_net_burn_per_month: number;
    runway_months_at_baseline: number | null;
    runway_months_at_full_avg: number | null;
  };
  top_categories_last_window: { category: string; amount: number; transactions: number }[];
  living_window_months: number;
}

interface LeverageResp {
  inputs: Record<string, number>;
  annual: {
    interest_cost: number; gross_yield: number; franking_credit: number;
    pretax_cashflow: number; tax_due: number; net_cashflow_after_tax: number;
  };
  monthly: { interest_cost: number; gross_yield: number; pretax_cashflow: number; net_cashflow_after_tax: number };
  verdict: string;
}

const KIND_META: Record<Recommendation['kind'], { label: string; icon: React.ReactNode; color: string }> = {
  cash:        { label: 'Cash',        icon: <Wallet className="w-4 h-4" />,        color: 'text-cyan-700 bg-cyan-50 dark:bg-cyan-900/20' },
  expenses:    { label: 'Expenses',    icon: <Receipt className="w-4 h-4" />,       color: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-800/20' },
  investments: { label: 'Investments', icon: <Scale className="w-4 h-4" />,         color: 'text-violet-700 bg-violet-50 dark:bg-violet-900/20' },
  tax:         { label: 'Tax',         icon: <Coins className="w-4 h-4" />,         color: 'text-lime-700 bg-lime-50 dark:bg-lime-900/20' },
  debt:        { label: 'Debt',        icon: <TrendingDown className="w-4 h-4" />,  color: 'text-rose-700 bg-rose-50 dark:bg-rose-900/20' },
  goals:       { label: 'Goals',       icon: <Target className="w-4 h-4" />,        color: 'text-blue-700 bg-blue-50 dark:bg-blue-900/20' },
  net_worth:   { label: 'Net Worth',   icon: <Heart className="w-4 h-4" />,         color: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20' },
};
const SEVERITY_META: Record<Recommendation['severity'], { label: string; bg: string; text: string }> = {
  high: { label: 'High',   bg: 'bg-rose-100 dark:bg-rose-900/30',   text: 'text-rose-800 dark:text-rose-300' },
  med:  { label: 'Medium', bg: 'bg-cyan-100 dark:bg-cyan-800/30', text: 'text-cyan-700 dark:text-cyan-300' },
  low:  { label: 'Low',    bg: 'bg-stone-100 dark:bg-stone-800',    text: 'text-stone-700 dark:text-stone-300' },
};
const KIND_ORDER: Recommendation['kind'][] = ['cash', 'debt', 'investments', 'expenses', 'tax', 'goals', 'net_worth'];

const Advisor = () => {
  const [recs, setRecs] = useState<Recs | null>(null);
  const [narrative, setNarrative] = useState<Narrative | null>(null);
  const [runway, setRunway] = useState<RunwayResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const [rRes, nRes, rwRes] = await Promise.all([
        fetch('/api/advisor/recommendations'),
        fetch('/api/advisor/narrative'),
        fetch('/api/advisor/runway?months_back=12&living_window=3'),
      ]);
      if (!rRes.ok) throw new Error('Failed to load recommendations');
      const r: Recs = await rRes.json();
      const n: Narrative = nRes.ok ? await nRes.json() : { narrative: null };
      const rw: RunwayResp | null = rwRes.ok ? await rwRes.json() : null;
      setRecs(r);
      setNarrative(n);
      setRunway(rw);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(false); }, []);

  const filtered = useMemo(() => {
    if (!recs) return [];
    if (filter === 'all') return recs.recommendations;
    return recs.recommendations.filter(r => r.kind === filter);
  }, [recs, filter]);

  const grouped = useMemo(() => {
    const out: Record<string, Recommendation[]> = {};
    filtered.forEach(r => {
      out[r.kind] = out[r.kind] || [];
      out[r.kind].push(r);
    });
    return out;
  }, [filtered]);

  const totalImpact = useMemo(
    () => (recs?.recommendations || []).reduce((s, r) => s + (r.est_impact_aud_per_year || 0), 0),
    [recs]
  );

  if (loading) return <div className="p-6"><Skeleton /></div>;
  if (error) return <div className="p-6"><ErrorState message={error} /></div>;
  if (!recs) return null;

  const score = recs.wealth_health_score;
  // Each tier pairs the light-mode shade with its dark-mode lighter sibling so
  // body-weight labels (text-base, weight 300 per WattVision) stay ≥ 4.5:1 WCAG
  // on both backgrounds — the big 6xl numeral is large-text and fine either way.
  const scoreColor = score >= 80
    ? 'text-emerald-600 dark:text-emerald-400'
    : score >= 60
      ? 'text-cyan-500 dark:text-cyan-400'
      : 'text-rose-600 dark:text-rose-400';
  const scoreLabel = score >= 80 ? 'Strong' : score >= 60 ? 'Solid, room to optimise' : 'Needs attention';

  const kindCount = (k: string) => recs.recommendations.filter(r => r.kind === k).length;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* ===== Header ===== */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl text-stone-900 dark:text-stone-50 flex items-center gap-3">
            <Lightbulb className="w-6 h-6 text-cyan-500" /> Advisor
          </h1>
          <p className="text-base text-stone-500 dark:text-stone-400">Holistic recommendations across cash, expenses, investments, tax, debt and goals.</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="px-3 py-1.5 border border-stone-200 dark:border-stone-700 rounded-lg text-base hover:bg-stone-100 dark:hover:bg-stone-800 inline-flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ===== Hero: score + narrative ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6 flex flex-col items-center justify-center">
          <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-2">Wealth Health</div>
          <div className={`text-6xl font-bold ${scoreColor}`}>{score}</div>
          <div className={`text-base ${scoreColor} mt-1`}>{scoreLabel}</div>
          <div className="text-xs text-stone-400 mt-3 text-center">{recs.recommendations.length} recommendations · est. {fmtAud(totalImpact)}/yr impact</div>
        </div>
        <div className="lg:col-span-2 bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6">
          <div className="flex items-center gap-2 mb-3 text-base text-stone-500 dark:text-stone-400">
            <Sparkles className="w-4 h-4 text-cyan-500" /> Your wealth in plain English
          </div>
          {narrative?.narrative ? (
            <p className="text-stone-700 dark:text-stone-200 leading-relaxed">{narrative.narrative}</p>
          ) : (
            <p className="text-stone-500 dark:text-stone-400 text-base">
              {narrative?.reason ? `Narrative unavailable: ${narrative.reason}` : 'Generating narrative...'}
            </p>
          )}
        </div>
      </div>

      {/* ===== Runway panel (true burn) ===== */}
      {runway && <RunwayPanel runway={runway} />}

      {/* ===== AI Rate-change Watcher — top wealth-coach pick (~$8k/yr) ===== */}
      <RateWatcherCard />

      {/* ===== Leverage calculator ===== */}
      <LeverageCalculator baselineBurn={runway?.runway.baseline_net_burn_per_month ?? 0} />

      {/* ===== KPI strip =====
          Income KPI uses the canonical structured_income.total_monthly
          (Nicole + interest + staking, ~$6,077) instead of the txn-only
          90-day median ($2,308) which is broken by uncategorised transactions
          and silently misrepresents survival.  See site-wide audit HIGH #6. */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <Kpi label="Net Worth" value={fmtAud(recs.kpis.net_worth_aud)} />
        <Kpi label="Cash" value={fmtAud(recs.kpis.cash_aud)} />
        <Kpi label="Debt" value={fmtAud(recs.kpis.debt_aud)} accent={recs.kpis.debt_aud > 0 ? 'text-rose-600' : ''} />
        <Kpi
          label="Income / mo"
          value={fmtAud(runway?.structured_income?.total_monthly ?? recs.kpis.monthly_income_avg_aud)}
        />
        <Kpi label="Spend / mo (90d)" value={fmtAud(recs.kpis.monthly_expenses_avg_aud)} />
        <Kpi label="Savings rate" value={fmtPct(recs.kpis.savings_rate_pct)} accent={recs.kpis.savings_rate_pct >= 20 ? 'text-emerald-600' : 'text-cyan-500'} />
        <Kpi label="Runway" value={recs.kpis.runway_months != null ? `${recs.kpis.runway_months.toFixed(1)} mo` : '—'} />
      </div>

      {/* ===== Filter chips ===== */}
      <div className="flex flex-wrap gap-2">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label={`All (${recs.recommendations.length})`} />
        {KIND_ORDER.map(k => kindCount(k) > 0 && (
          <FilterChip
            key={k}
            active={filter === k}
            onClick={() => setFilter(k)}
            label={`${KIND_META[k].label} (${kindCount(k)})`}
            icon={KIND_META[k].icon}
          />
        ))}
      </div>

      {/* ===== Grouped recommendations ===== */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-10 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
          <p className="text-stone-700 dark:text-stone-200 ">Nothing flagged in this category — keep doing what you're doing.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {KIND_ORDER.filter(k => grouped[k]?.length).map(kind => (
            <div key={kind}>
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-base mb-3 ${KIND_META[kind].color}`}>
                {KIND_META[kind].icon}
                {KIND_META[kind].label}
                <span className="text-xs opacity-70">({grouped[kind].length})</span>
              </div>
              <div className="space-y-2">
                {grouped[kind].map(r => (
                  <RecCard
                    key={r.id}
                    rec={r}
                    expanded={!!expanded[r.id]}
                    onToggle={() => setExpanded(prev => ({ ...prev, [r.id]: !prev[r.id] }))}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-stone-400 text-center pt-4">
        Generated {new Date(recs.generated_at).toLocaleString('en-AU')} · Recommendations are heuristic, not financial advice.
      </p>
    </div>
  );
};

const Kpi = ({ label, value, accent }: { label: string; value: string; accent?: string }) => (
  <div className="bg-white dark:bg-stone-900 rounded-lg border border-stone-200 dark:border-stone-800 px-3 py-2">
    <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400 truncate">{label}</div>
    <div className={`text-base font-semibold mt-0.5 ${accent || 'text-stone-800 dark:text-stone-100'}`}>{value}</div>
  </div>
);

const FilterChip = ({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon?: React.ReactNode }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-full text-base border inline-flex items-center gap-1.5 transition-colors ${
      active
        ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900'
        : 'bg-white dark:bg-stone-900 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800'
    }`}
  >
    {icon}
    {label}
  </button>
);

const RecCard = ({ rec, expanded, onToggle }: { rec: Recommendation; expanded: boolean; onToggle: () => void }) => {
  const sev = SEVERITY_META[rec.severity];
  return (
    <div className="bg-white dark:bg-stone-900 rounded-lg border border-stone-200 dark:border-stone-800">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-stone-50 dark:hover:bg-stone-800/50 rounded-lg"
      >
        <div className={`mt-0.5 px-2 py-0.5 rounded text-xs uppercase tracking-wide ${sev.bg} ${sev.text}`}>
          {sev.label}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="text-stone-800 dark:text-stone-100">{rec.title}</div>
            {rec.est_impact_aud_per_year ? (
              <div className="text-base font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                ≈ {fmtAud(rec.est_impact_aud_per_year)}/yr
              </div>
            ) : null}
          </div>
          <div className="text-base text-stone-500 dark:text-stone-400 mt-0.5">{rec.detail}</div>
        </div>
        <ChevronRight className={`w-4 h-4 text-stone-400 mt-1 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-stone-100 dark:border-stone-800 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-1">Evidence</div>
            <div className="text-base text-stone-700 dark:text-stone-200">{rec.evidence}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-1 flex items-center gap-1">
              <ArrowRight className="w-3 h-3" /> Suggested action
            </div>
            <div className="text-base text-stone-700 dark:text-stone-200">{rec.action}</div>
          </div>
          {rec.links.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {rec.links.map(l => (
                <NavLink
                  key={l}
                  to={l}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200"
                >
                  Go to {l} <ExternalLink className="w-3 h-3" />
                </NavLink>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------- Runway panel ----------
const RunwayPanel = ({ runway }: { runway: RunwayResp }) => {
  const { baseline_income, baseline_living, runway: r, top_categories_last_window, series, living_window_months } = runway;
  const baselineBurn = r.baseline_net_burn_per_month;
  const baselineRunway = r.runway_months_at_baseline;
  const fullAvgRunway = r.runway_months_at_full_avg;
  const runwayYears = baselineRunway != null ? (baselineRunway / 12).toFixed(1) : '—';
  const chartData = series.map(s => ({ ...s, label: fmtMonthLabel(s.month) }));

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-5 h-5 text-cyan-500" />
        <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">Cashflow reality &amp; runway</h3>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MiniStat label={`Baseline income (${living_window_months}mo median)`} value={fmtAud(baseline_income)} accent="text-emerald-600" />
        <MiniStat label={`Baseline living spend`} value={fmtAud(baseline_living)} accent="text-rose-600" />
        <MiniStat label="Net burn / month" value={fmtAud(-baselineBurn)} accent={baselineBurn > 0 ? 'text-rose-600' : 'text-emerald-600'} sub={baselineBurn > 0 ? 'drawdown' : 'surplus'} />
        <MiniStat
          label="Runway at baseline"
          value={baselineRunway != null ? `${baselineRunway.toFixed(1)} mo` : '∞'}
          sub={baselineRunway != null ? `≈ ${runwayYears} years of cash` : 'income > spend'}
          accent="text-stone-800 dark:text-stone-100"
        />
      </div>

      {/* Dual-bar chart: income vs living vs project */}
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-stone-200 dark:text-stone-800" vertical={false} />
          <XAxis dataKey="label" stroke="currentColor" className="text-stone-500 dark:text-stone-400" fontSize={10} />
          <YAxis stroke="currentColor" className="text-stone-500 dark:text-stone-400" fontSize={10} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
          <Tooltip formatter={(v: number) => fmtAud(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="income" name="Income" fill="#10b981" radius={[3, 3, 0, 0]} />
          <Bar dataKey="living" name="Living spend" fill="#f43f5e" radius={[3, 3, 0, 0]} />
          <Bar dataKey="project_spend" name="Project spend" fill="#a16207" radius={[3, 3, 0, 0]} />
          <Bar dataKey="invest" name="Investments" fill="#7c3aed" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Scenario compare */}
        <div className="bg-stone-50 dark:bg-stone-800/50 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-2">Runway scenarios</div>
          <div className="space-y-2 text-base">
            <Scenario
              label="Baseline (last 3 months median)"
              burn={baselineBurn}
              months={baselineRunway}
            />
            <Scenario
              label="12-month avg incl. project spikes"
              burn={r.full_avg_net_burn_per_month}
              months={fullAvgRunway}
              muted
            />
          </div>
        </div>
        {/* Top controllable categories */}
        <div className="bg-stone-50 dark:bg-stone-800/50 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-2">Top living-spend categories (avg/mo last {living_window_months}mo)</div>
          <ul className="space-y-1 text-base">
            {top_categories_last_window.slice(0, 6).map(c => (
              <li key={c.category} className="flex items-center justify-between">
                <span className="text-stone-700 dark:text-stone-200">{c.category}</span>
                <span className="text-stone-800 dark:text-stone-100">{fmtAud(c.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

const Scenario = ({ label, burn, months, muted }: { label: string; burn: number; months: number | null; muted?: boolean }) => (
  <div className={`flex items-baseline justify-between ${muted ? 'text-stone-500' : ''}`}>
    <span className="text-stone-600 dark:text-stone-300 text-xs">{label}</span>
    <span>
      <span className={`font-semibold ${burn > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{fmtAud(-burn)}/mo</span>
      <span className="mx-1 text-stone-400">→</span>
      <span className="font-semibold">{months != null ? `${months.toFixed(1)} mo` : '∞'}</span>
    </span>
  </div>
);

const MiniStat = ({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) => (
  <div className="bg-stone-50 dark:bg-stone-800/50 rounded-lg px-3 py-2">
    <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400 truncate">{label}</div>
    <div className={`text-lg font-semibold mt-0.5 ${accent || 'text-stone-800 dark:text-stone-100'}`}>{value}</div>
    {sub && <div className="text-xs text-stone-400 mt-0.5">{sub}</div>}
  </div>
);

const fmtMonthLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
};

// ============================================================================
// Rate Watcher Card — calls /api/intel/rate-watcher.
//
// Surfaces the single highest-leverage cash-yield move + Kimi narrative.
// Designed to be the first thing the user sees when they reach Advisor.
// ============================================================================
interface RateWatcherTopMove {
  name: string;
  balance_aud: number;
  monthly_uplift_aud: number;
  apy: number;
  currency: string;
}
interface RateWatcherResp extends CacheMeta {
  opportunity_monthly_aud: number;
  opportunity_yearly_aud: number;
  market_ceiling_apy: number;
  idle_total_aud: number;
  top_move?: RateWatcherTopMove;
  narrative: string;
  narrative_provider: string;
  as_of: string;
}

const RateWatcherCard = () => {
  const [data, setData] = useState<RateWatcherResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);

  // Iteration 22: mount-load uses `cache_only=true` so the page renders
  // instantly with the last cached scan and no Kimi fires. The user clicks
  // "Run analysis" / "Re-scan" to spend tokens.
  const load = async (mode: 'mount' | 'fresh' = 'mount') => {
    setLoading(true);
    setErr(null);
    try {
      const qs = mode === 'fresh' ? '?force=true' : '?cache_only=true';
      const res = await fetch(`/api/intel/rate-watcher${qs}`);
      if (!res.ok) throw new Error(`rate-watcher ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  };
  useEffect(() => { load('mount'); }, []);
  const noCache = data?.cached === false;

  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 border-l-emerald-500 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
          <Zap className="w-3.5 h-3.5 text-emerald-500" /> AI Rate Watcher
          {data && !noCache && data.narrative_provider && (
            <span className="text-stone-400 dark:text-stone-500">
              · via {data.narrative_provider}
            </span>
          )}
          {data?._cached_at && data?._age_seconds != null && (
            <span className={`text-stone-400 dark:text-stone-500 ${data._stale ? 'text-amber-500 dark:text-amber-400' : ''}`}>
              · {fmtAge(data._age_seconds)}{data._stale ? ' · stale' : ''}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => load('fresh')}
          disabled={loading}
          className="text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 inline-flex items-center gap-1 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {loading ? 'Scanning' : (noCache ? 'Run analysis' : 'Re-scan')}
        </button>
      </div>

      {err ? (
        <ErrorState title="Rate watcher unavailable" message={err} onRetry={() => load('fresh')} />
      ) : noCache ? (
        <p className="text-base text-stone-500 dark:text-stone-400">
          No analysis yet — click <span className="text-cyan-600 dark:text-cyan-400">Run analysis</span> to scan the AU savings landscape and find dollar opportunities. (One Kimi call.)
        </p>
      ) : !data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <div className="flex items-baseline flex-wrap gap-x-5 gap-y-2 mb-3">
            <div>
              <div className="text-3xl tabular-nums font-mono text-emerald-600 dark:text-emerald-400">
                +{fmtAud(data.opportunity_monthly_aud)}<span className="text-base text-stone-500 dark:text-stone-400">/mo</span>
              </div>
              <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 mt-0.5">
                {fmtAud(data.opportunity_yearly_aud)}/yr opportunity
              </div>
            </div>
            {data.top_move && (
              <div className="text-base text-stone-700 dark:text-stone-300">
                Top move: <span className="text-stone-900 dark:text-stone-100">{data.top_move.name}</span>
                {' · '}
                <span className="font-mono tabular-nums">{fmtAud(data.top_move.balance_aud)}</span>
                {' '}@{' '}
                <span className="font-mono tabular-nums">{data.top_move.apy.toFixed(2)}%</span>
                {' → '}
                <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{data.market_ceiling_apy.toFixed(2)}%</span>
              </div>
            )}
          </div>

          <p className="text-base text-stone-900 dark:text-stone-100 leading-relaxed">
            {data.narrative}
          </p>

          {data.top_move && (
            <button
              type="button"
              onClick={() => setDraftOpen(true)}
              className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              <Mail className="w-4 h-4" /> Draft email (AI)
            </button>
          )}

          <div className="mt-3 text-xs font-mono uppercase tracking-wider text-stone-400 dark:text-stone-500">
            scanned {new Date(data.as_of).toLocaleString('en-AU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · landscape Q2 2026
          </div>

          {draftOpen && data.top_move && (
            <NegotiationDraftModal
              topMove={data.top_move}
              marketCeilingApy={data.market_ceiling_apy}
              onClose={() => setDraftOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
};

// ============================================================================
// Negotiation Draft Modal
//
// Pops from the Rate Watcher's "Draft email" button.  Shows a kind-picker
// (move / rate-match / consolidation) seeded by the account's APY state, a
// target-bank selector, then calls /api/intel/negotiation-draft and renders
// the generated Subject + Body with copy-to-clipboard actions.
// ============================================================================
interface DraftResp {
  kind: string;
  subject: string;
  body: string;
  provider: string;
  opportunity_monthly_aud: number;
  opportunity_yearly_aud: number;
}

const KNOWN_AU_TARGETS = [
  { name: 'ME Bank',  apy: 5.55 },
  { name: 'ING Savings Maximiser', apy: 5.50 },
  { name: 'ubank Save', apy: 5.50 },
  { name: 'Rabobank PremiumSaver', apy: 5.50 },
  { name: 'AMP Saver', apy: 5.40 },
  { name: 'Macquarie Savings', apy: 5.00 },
];

const NegotiationDraftModal = ({
  topMove,
  marketCeilingApy,
  onClose,
}: {
  topMove: RateWatcherTopMove;
  marketCeilingApy: number;
  onClose: () => void;
}) => {
  const defaultKind = (topMove.apy ?? 0) === 0 ? 'move' : 'rate-match';
  const [kind, setKind] = useState<'rate-match' | 'consolidation' | 'move'>(defaultKind as any);
  const [targetProvider, setTargetProvider] = useState(KNOWN_AU_TARGETS[0].name);
  const [targetApy, setTargetApy] = useState(marketCeilingApy);
  const [draft, setDraft] = useState<DraftResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<'subject' | 'body' | 'both' | null>(null);

  const generate = async () => {
    setLoading(true); setErr(null); setDraft(null);
    try {
      const res = await fetch('/api/intel/negotiation-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          account_name: topMove.name,
          balance_aud: topMove.balance_aud,
          current_apy: topMove.apy,
          current_provider: topMove.name,
          target_provider: targetProvider,
          target_apy: targetApy,
        }),
      });
      if (!res.ok) throw new Error(`draft ${res.status}`);
      setDraft(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to generate');
    } finally { setLoading(false); }
  };

  const copy = async (what: 'subject' | 'body' | 'both') => {
    if (!draft) return;
    const text = what === 'subject' ? draft.subject : what === 'body' ? draft.body : `Subject: ${draft.subject}\n\n${draft.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* noop */ }
  };

  return (
    <div
      className="fixed inset-0 bg-stone-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Draft negotiation email"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-2xl font-display text-stone-900 dark:text-stone-50">AI Negotiation Draft</h3>
            <p className="text-base text-stone-500 dark:text-stone-400">
              {topMove.name} · {fmtAud(topMove.balance_aud)} @ {topMove.apy.toFixed(2)}% APY
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 block mb-1">
              Email kind
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as any)}
              className="w-full px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
            >
              {(topMove.apy ?? 0) > 0 && <option value="rate-match">Rate match (keep at current bank)</option>}
              <option value="move">Move out (to better rate)</option>
              <option value="consolidation">Open new account (at target)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 block mb-1">
              Target provider
            </label>
            <select
              value={targetProvider}
              onChange={(e) => {
                const p = KNOWN_AU_TARGETS.find(t => t.name === e.target.value);
                setTargetProvider(e.target.value);
                if (p) setTargetApy(p.apy);
              }}
              className="w-full px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
            >
              {KNOWN_AU_TARGETS.map(t => <option key={t.name} value={t.name}>{t.name} ({t.apy.toFixed(2)}%)</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 block mb-1">
              Target APY
            </label>
            <input
              type="number"
              step="0.01"
              value={targetApy}
              onChange={(e) => setTargetApy(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base font-mono tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="w-full mb-4 inline-flex items-center justify-center gap-2 px-3 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg text-base disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {loading ? 'Drafting via Kimi…' : (draft ? 'Re-draft' : 'Generate draft')}
        </button>

        {err && <ErrorState title="Draft failed" message={err} onRetry={generate} />}

        {draft && (
          <div className="space-y-3">
            <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
              via {draft.provider} · +{fmtAud(draft.opportunity_monthly_aud)}/mo ({fmtAud(draft.opportunity_yearly_aud)}/yr) if accepted
            </div>
            <div className="border border-stone-200 dark:border-stone-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">Subject</span>
                <button
                  type="button"
                  onClick={() => copy('subject')}
                  className="inline-flex items-center gap-1 text-xs text-cyan-500 hover:text-cyan-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
                  aria-label="Copy subject"
                >
                  {copied === 'subject' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied === 'subject' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-base text-stone-900 dark:text-stone-100 break-words">{draft.subject}</p>
            </div>
            <div className="border border-stone-200 dark:border-stone-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">Body</span>
                <button
                  type="button"
                  onClick={() => copy('body')}
                  className="inline-flex items-center gap-1 text-xs text-cyan-500 hover:text-cyan-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
                  aria-label="Copy body"
                >
                  {copied === 'body' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied === 'body' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="text-base text-stone-900 dark:text-stone-100 whitespace-pre-wrap font-sans leading-relaxed">{draft.body}</pre>
            </div>
            <button
              type="button"
              onClick={() => copy('both')}
              className="inline-flex items-center gap-2 text-base text-cyan-500 hover:text-cyan-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
            >
              {copied === 'both' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied === 'both' ? 'Copied entire email' : 'Copy entire email'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------- Leverage Calculator ----------
const LeverageCalculator = ({ baselineBurn }: { baselineBurn: number }) => {
  const [loan, setLoan] = useState(400000);
  const [rate, setRate] = useState(6.25);
  const [yieldPct, setYieldPct] = useState(5.5);
  const [franking, setFranking] = useState(30);
  const [tax, setTax] = useState(47);
  const [result, setResult] = useState<LeverageResp | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          loan_amount_aud: String(loan),
          loan_rate_pct: String(rate),
          yield_pct: String(yieldPct),
          franking_pct: String(franking),
          marginal_tax_pct: String(tax),
        });
        const res = await fetch(`/api/advisor/leverage-calc?${params}`);
        if (res.ok) setResult(await res.json());
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [loan, rate, yieldPct, franking, tax]);

  const presets = [
    { name: 'Franked AU banks (CBA/WBC)', rate: 6.25, yield: 5.5, franking: 30 },
    { name: 'Growth ETF (VGS)', rate: 6.25, yield: 2.0, franking: 0 },
    { name: 'A-REIT (VAP)', rate: 6.25, yield: 4.5, franking: 10 },
    { name: 'Rental property 6.5% gross', rate: 6.25, yield: 6.5, franking: 0 },
  ];

  const impactOnRunway = result && baselineBurn > 0
    ? (result.annual.net_cashflow_after_tax / 12) / baselineBurn * 100
    : null;

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Calculator className="w-5 h-5 text-violet-600" />
        <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">Leverage calculator</h3>
        <span className="text-xs text-stone-500 dark:text-stone-400">Only borrow if cashflow-positive from month one.</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 mb-3">
            {presets.map(p => (
              <button
                key={p.name}
                onClick={() => { setRate(p.rate); setYieldPct(p.yield); setFranking(p.franking); }}
                className="px-2.5 py-1 text-xs border border-stone-200 dark:border-stone-700 rounded-full hover:bg-stone-50 dark:hover:bg-stone-800"
              >
                {p.name}
              </button>
            ))}
          </div>
          <SliderInput label="Loan amount (AUD)" value={loan} onChange={setLoan} min={50000} max={2000000} step={10000} format={v => `$${(v/1000).toFixed(0)}k`} />
          <SliderInput label="Loan interest rate (%)" value={rate} onChange={setRate} min={3} max={12} step={0.05} format={v => `${v.toFixed(2)}%`} />
          <SliderInput label="Investment yield (%)" value={yieldPct} onChange={setYieldPct} min={0} max={15} step={0.1} format={v => `${v.toFixed(2)}%`} />
          <SliderInput label="Franking credit (%)" value={franking} onChange={setFranking} min={0} max={30} step={1} format={v => `${v}%`} />
          <SliderInput label="Marginal tax rate (%)" value={tax} onChange={setTax} min={0} max={47} step={1} format={v => `${v}%`} />
        </div>

        {/* Output */}
        <div>
          {loading && <div className="text-xs text-stone-400 mb-2">Calculating…</div>}
          {result && (
            <>
              <div className={`rounded-lg p-4 mb-3 ${
                result.annual.pretax_cashflow >= 0 && result.annual.net_cashflow_after_tax >= 0
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800'
                  : result.annual.net_cashflow_after_tax >= 0
                    ? 'bg-cyan-50 dark:bg-cyan-800/20 border border-cyan-200 dark:border-cyan-700'
                    : 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800'
              }`}>
                <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-1">Verdict</div>
                <div className="text-base ">{result.verdict}</div>
              </div>

              <table className="w-full text-base">
                <tbody>
                  <Row label="Annual interest cost" value={fmtAud(-result.annual.interest_cost)} red />
                  <Row label="Annual yield (gross)" value={fmtAud(result.annual.gross_yield)} green />
                  <Row label="Franking credits" value={fmtAud(result.annual.franking_credit)} green muted />
                  <Row label="Pre-tax cashflow" value={fmtAud(result.annual.pretax_cashflow)} bold color={result.annual.pretax_cashflow >= 0 ? 'text-emerald-600' : 'text-rose-600'} />
                  <Row label="Tax due (after deducting interest)" value={fmtAud(-result.annual.tax_due)} red muted />
                  <Row label="Net cashflow after tax" value={fmtAud(result.annual.net_cashflow_after_tax)} bold color={result.annual.net_cashflow_after_tax >= 0 ? 'text-emerald-600' : 'text-rose-600'} big />
                  <Row label="Monthly after-tax" value={fmtAud(result.monthly.net_cashflow_after_tax)} color={result.monthly.net_cashflow_after_tax >= 0 ? 'text-emerald-600' : 'text-rose-600'} />
                </tbody>
              </table>

              {impactOnRunway !== null && (
                <div className="mt-3 p-3 bg-stone-50 dark:bg-stone-800/50 rounded-lg text-base text-stone-600 dark:text-stone-300">
                  Impact on runway: this trade would {result.annual.net_cashflow_after_tax >= 0 ? 'cover' : 'add'} <strong>{Math.abs(impactOnRunway).toFixed(1)}%</strong> of your current monthly burn.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const SliderInput = ({ label, value, onChange, min, max, step, format }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; format: (v: number) => string }) => (
  <div>
    <div className="flex items-center justify-between text-xs mb-1">
      <label className="text-stone-500 dark:text-stone-400">{label}</label>
      <span className="font-semibold text-stone-800 dark:text-stone-100">{format(value)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full accent-cyan-500"
    />
  </div>
);

const Row = ({ label, value, red, green, bold, big, color, muted }: { label: string; value: string; red?: boolean; green?: boolean; bold?: boolean; big?: boolean; color?: string; muted?: boolean }) => (
  <tr className={`border-b border-stone-100 dark:border-stone-800 ${muted ? 'opacity-75' : ''}`}>
    <td className={`py-1.5 ${muted ? 'text-stone-500' : 'text-stone-700 dark:text-stone-200'}`}>{label}</td>
    <td className={`py-1.5 text-right ${bold ? 'font-semibold' : ''} ${big ? 'text-lg' : ''} ${color || (red ? 'text-rose-600' : green ? 'text-emerald-600' : 'text-stone-800 dark:text-stone-100')}`}>
      {value}
    </td>
  </tr>
);

export default Advisor;
