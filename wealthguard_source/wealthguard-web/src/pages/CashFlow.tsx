import { useEffect, useState, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, ReferenceLine,
} from 'recharts';
import { Wallet, TrendingUp, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import SectionHeader from '../components/SectionHeader';
import ErrorState from '../components/ErrorState';
import Skeleton from '../components/Skeleton';
import { Link } from 'react-router-dom';

// ----------------------------------------------------------------------------
// Types — mirror /api/advisor/runway shape
// ----------------------------------------------------------------------------
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
}
interface RunwayRow { month: string; income: number; invest: number; living: number; project_spend: number; net_living: number }
interface RunwayResp {
  series: RunwayRow[];
  baseline_income: number;
  baseline_living: number;
  runway: { cash_aud: number; baseline_net_burn_per_month: number; full_avg_net_burn_per_month: number; runway_months_at_baseline: number | null; runway_months_at_full_avg: number | null };
  structured_income?: StructuredIncome;
  top_categories_last_window: { category: string; amount: number; transactions: number }[];
  living_window_months: number;
}

const fmtAud = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

const fmtAudShort = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${v < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 100_000) return `${v < 0 ? '-' : ''}$${Math.round(abs / 1000)}k`;
  if (abs >= 1_000) return `${v < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`;
  return fmtAud(v);
};

const fmtMonth = (ym: string) => {
  const [y, m] = ym.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
};

const CashFlowPage = () => {
  const [runway, setRunway] = useState<RunwayResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/advisor/runway?months_back=12&living_window=3');
      if (!res.ok) throw new Error(`runway ${res.status}`);
      setRunway(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const series = useMemo(() => (runway?.series ?? []).map(r => ({
    ...r,
    label: fmtMonth(r.month),
    net: r.income - r.living - r.project_spend,          // pure cash-out net each month
  })), [runway]);

  if (loading && !runway) return <div className="p-6 space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (error && !runway) return <div className="p-6"><ErrorState title="Couldn't load cashflow" message={error} onRetry={load} /></div>;
  if (!runway) return null;

  const si = runway.structured_income;
  const income = si?.total_monthly ?? runway.baseline_income;
  const living = runway.baseline_living;
  const netMonthly = income - living;
  const surplus = netMonthly >= 0;
  const cash = runway.runway.cash_aud;
  const months = runway.runway.runway_months_at_baseline;
  const fullAvgBurn = runway.runway.full_avg_net_burn_per_month;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl text-stone-900 dark:text-stone-50 flex items-center gap-3">
            <Wallet className="w-6 h-6 text-stone-500 dark:text-stone-400" strokeWidth={1.75} />
            Cashflow
          </h1>
          <p className="text-base text-stone-500 dark:text-stone-400">
            Real income · real spending · what it means for survival.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 border border-stone-200 dark:border-stone-700 rounded-lg text-base hover:bg-stone-100 dark:hover:bg-stone-800 inline-flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      {/* Hero — 4 tiles: income / spend / net / runway */}
      <section>
        <SectionHeader icon={TrendingUp} label="This month at baseline" />
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Tile
              label="Monthly income"
              value={fmtAudShort(income)}
              sub={si ? (
                (si.staking_monthly ?? 0) > 0
                  ? `Nicole ${fmtAudShort(si.nicole_monthly)} · interest ${fmtAudShort(si.interest_monthly)} · staking ${fmtAudShort(si.staking_monthly ?? 0)}`
                  : `Nicole ${fmtAudShort(si.nicole_monthly)} · interest ${fmtAudShort(si.interest_monthly)}`
              ) : ''}
              accent="text-emerald-600 dark:text-emerald-400"
            />
            <Tile
              label="Living spend"
              value={fmtAudShort(living)}
              sub={`project + investment excluded`}
              accent="text-rose-600 dark:text-rose-400"
            />
            <Tile
              label={surplus ? 'Net / mo (surplus)' : 'Net burn / mo'}
              value={`${netMonthly >= 0 ? '+' : ''}${fmtAudShort(netMonthly)}`}
              sub={`12-mo avg ${fmtAudShort(-fullAvgBurn)}`}
              accent={surplus ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}
            />
            <Tile
              label="Cash runway"
              value={months != null ? `${months.toFixed(0)} mo` : '∞'}
              sub={months != null ? `≈ ${(months / 12).toFixed(1)} yrs` : 'income covers burn'}
              accent="text-stone-900 dark:text-stone-50"
            />
          </div>
        </div>
      </section>

      {/* Income composition — the answer to "where does our money come from?" */}
      {si && (
        <section>
          <SectionHeader icon={TrendingUp} label="Income composition" />
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
            <table className="min-w-full text-base">
              <thead>
                <tr className="border-b border-stone-200 dark:border-stone-800 text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  <th className="text-left py-2">Source</th>
                  <th className="text-left py-2">Detail</th>
                  <th className="text-right py-2">Monthly AUD</th>
                  <th className="text-right py-2">% of income</th>
                </tr>
              </thead>
              <tbody>
                {si.nicole_monthly > 0 && (
                  <tr className="border-b border-stone-100 dark:border-stone-800/60">
                    <td className="py-2.5 text-stone-900 dark:text-stone-100">Nicole's salary</td>
                    <td className="py-2.5 text-stone-500 dark:text-stone-400">recurring income</td>
                    <td className="py-2.5 text-right tabular-nums">{fmtAud(si.nicole_monthly)}</td>
                    <td className="py-2.5 text-right tabular-nums text-stone-500 dark:text-stone-400">
                      {income > 0 ? `${(si.nicole_monthly / income * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                )}
                {si.interest_breakdown.map(i => (
                  <tr key={i.account} className="border-b border-stone-100 dark:border-stone-800/60">
                    <td className="py-2.5 text-stone-900 dark:text-stone-100">{i.account}</td>
                    <td className="py-2.5 text-stone-500 dark:text-stone-400 tabular-nums">
                      {fmtAudShort(i.balance_aud)} @ {i.apy_pct}%
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{fmtAud(i.monthly_aud)}</td>
                    <td className="py-2.5 text-right tabular-nums text-stone-500 dark:text-stone-400">
                      {income > 0 ? `${(i.monthly_aud / income * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
                {(si.staking_breakdown ?? []).map((s) => (
                  <tr key={`${s.source}-${s.address}`} className="border-b border-stone-100 dark:border-stone-800/60">
                    <td className="py-2.5 text-stone-900 dark:text-stone-100">{s.source}</td>
                    <td className="py-2.5 text-stone-500 dark:text-stone-400 tabular-nums">
                      {s.address.slice(0, 10)}…{s.address.slice(-4)} · {s.basis}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{fmtAud(s.monthly_aud)}</td>
                    <td className="py-2.5 text-right tabular-nums text-stone-500 dark:text-stone-400">
                      {income > 0 ? `${(s.monthly_aud / income * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
                {si.txn_income_monthly > 0 && (
                  <tr className="border-b border-stone-100 dark:border-stone-800/60">
                    <td className="py-2.5 text-stone-900 dark:text-stone-100">Transaction income</td>
                    <td className="py-2.5 text-stone-500 dark:text-stone-400">3-mo median from transactions</td>
                    <td className="py-2.5 text-right tabular-nums">{fmtAud(si.txn_income_monthly)}</td>
                    <td className="py-2.5 text-right tabular-nums text-stone-500 dark:text-stone-400">
                      {income > 0 ? `${(si.txn_income_monthly / income * 100).toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-stone-300 dark:border-stone-700">
                  <td className="py-3 text-stone-900 dark:text-stone-100" colSpan={2}>Total monthly</td>
                  <td className="py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmtAud(income)}</td>
                  <td className="py-3 text-right tabular-nums text-stone-500 dark:text-stone-400">100%</td>
                </tr>
              </tfoot>
            </table>

            {/* Opportunity row */}
            {si.opportunity_monthly_aud && si.opportunity_monthly_aud > 0 && si.opportunity_items && si.opportunity_items.length > 0 && (
              <Link
                to="/advisor"
                className="mt-5 block border border-stone-200 dark:border-stone-800 border-l-2 border-l-emerald-500 rounded-lg p-3 hover:bg-stone-50 dark:hover:bg-stone-800/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-mono uppercase text-stone-500 dark:text-stone-400">
                    <TrendingUp className="w-3 h-3" /> Income opportunity
                  </div>
                  <span className="text-xs font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                    +{fmtAudShort(si.opportunity_monthly_aud)}/mo
                  </span>
                </div>
                <div className="text-base text-stone-900 dark:text-stone-100 mt-1">
                  Move {si.opportunity_items.map(i => i.account.replace(' Account', '')).join(', ')} to a {si.opportunity_items[0].target_apy_pct}% AUD account
                </div>
              </Link>
            )}
          </div>
        </section>
      )}

      {/* Income vs living / project spend chart — last 12 months actual */}
      <section>
        <SectionHeader label={`Income vs spending · last ${series.length} months (actual)`} />
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-stone-200 dark:text-stone-800" />
              <XAxis dataKey="label" stroke="currentColor" className="text-stone-500 dark:text-stone-400" fontSize={11} />
              <YAxis stroke="currentColor" className="text-stone-500 dark:text-stone-400" fontSize={11} tickFormatter={v => `$${Math.round(v / 1000)}k`} />
              <Tooltip
                contentStyle={{ background: 'rgba(18,18,18,0.92)', border: '1px solid #2C2C2E', borderRadius: 8, color: '#fff', fontSize: 12 }}
                formatter={(v: number) => fmtAud(v)}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name="Income" fill="#32D74B" radius={[3, 3, 0, 0]} />
              <Bar dataKey="living" name="Living spend" fill="#FF453A" radius={[3, 3, 0, 0]} />
              <Bar dataKey="project_spend" name="Project spend" fill="#a16207" radius={[3, 3, 0, 0]} />
              <Bar dataKey="invest" name="Investment moves" fill="#00E5FF" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Cash trajectory — cumulative, plus baseline income reference */}
      <section>
        <SectionHeader label="Net living trajectory · 12mo" />
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00E5FF" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#00E5FF" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-stone-200 dark:text-stone-800" />
              <XAxis dataKey="label" stroke="currentColor" className="text-stone-500 dark:text-stone-400" fontSize={11} />
              <YAxis stroke="currentColor" className="text-stone-500 dark:text-stone-400" fontSize={11} tickFormatter={v => `$${Math.round(v / 1000)}k`} />
              <Tooltip
                contentStyle={{ background: 'rgba(18,18,18,0.92)', border: '1px solid #2C2C2E', borderRadius: 8, color: '#fff', fontSize: 12 }}
                formatter={(v: number) => fmtAud(v)}
              />
              <ReferenceLine y={0} stroke="#FF453A" strokeDasharray="4 4" />
              <Area type="monotone" dataKey="net_living" name="Net (income − living)" stroke="#00E5FF" strokeWidth={2} fill="url(#netGrad)" />
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-2">
            Red dashed = break-even. Above the line means income covered that month; below means cash came out of savings.
          </p>
        </div>
      </section>

      {/* Top living categories */}
      {runway.top_categories_last_window.length > 0 && (
        <section>
          <SectionHeader label={`Biggest living-spend buckets · last ${runway.living_window_months} months avg`} />
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
            <ul className="space-y-2">
              {runway.top_categories_last_window.slice(0, 8).map(c => {
                const pctOfIncome = income > 0 ? (c.amount / income) * 100 : 0;
                return (
                  <li key={c.category}>
                    <div className="flex items-baseline justify-between text-base">
                      <span className="text-stone-900 dark:text-stone-100 truncate pr-2">{c.category}</span>
                      <span className="text-stone-500 dark:text-stone-400 tabular-nums ml-2">
                        {fmtAudShort(c.amount)}
                        <span className="text-xs text-stone-400 ml-1">· {pctOfIncome.toFixed(0)}% of income</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                      <div className="h-full bg-rose-500 dark:bg-rose-400" style={{ width: `${Math.min(pctOfIncome, 100)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* Cash position summary */}
      <section>
        <SectionHeader label="Where the cash sits" />
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Tile label="Cash available" value={fmtAud(cash)} sub="savings + checking, AUD-equivalent" />
            <Tile
              label="Burn @ 12-mo avg"
              value={fmtAudShort(-fullAvgBurn)}
              sub={fullAvgBurn > 0 ? `includes project spikes` : 'surplus incl. projects'}
              accent={fullAvgBurn > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}
            />
            <Tile
              label="Runway @ 12-mo avg"
              value={runway.runway.runway_months_at_full_avg != null ? `${runway.runway.runway_months_at_full_avg.toFixed(0)} mo` : '∞'}
              sub="accounts for reno/build spikes"
              accent={runway.runway.runway_months_at_full_avg != null && runway.runway.runway_months_at_full_avg < 12 ? 'text-rose-600 dark:text-rose-400' : 'text-stone-900 dark:text-stone-50'}
            />
          </div>
          {months != null && months < 12 && (
            <div className="mt-4 flex items-center gap-2 text-base text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              Runway below 12 months. Act on the opportunity panel above or cut the biggest living bucket.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

const Tile = ({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) => (
  <div>
    <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">{label}</div>
    <div className={`text-3xl mt-1 tabular-nums ${accent || 'text-stone-900 dark:text-stone-50'}`}>{value}</div>
    {sub && <div className="text-xs text-stone-500 dark:text-stone-400 mt-1">{sub}</div>}
  </div>
);

// Named alias — used by the consolidated `/spending` page tab nav.
export const CashFlowView = CashFlowPage;

export default CashFlowPage;
