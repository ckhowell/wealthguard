import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, LineChart, Line,
} from 'recharts';
import {
  TrendingDown, TrendingUp, ArrowUpRight, ArrowDownRight, Minus,
  ShoppingBag, Receipt, Calendar, Wallet, Sparkles, Search,
  ChevronUp, ChevronDown, Filter, Hammer, Tag, RefreshCw, Loader2,
} from 'lucide-react';
import Skeleton from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import { useIncome } from '../hooks/useIncome';
import { usePersistentState } from '../hooks/usePersistentState';
import { fmtAge } from '../lib/aiCache';
import type { Account } from '../types/api';

interface ProjectOpt {
  id: number;
  name: string;
  transaction_count: number;
  total_spend: number;
}

// ---------- formatters ----------
const fmtAud = (v: number, opts?: Intl.NumberFormatOptions) =>
  v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0, ...opts });
const fmtAud2 = (v: number) =>
  v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 });
const fmtPct = (v: number | null | undefined, sign = true) => {
  if (v === null || v === undefined) return '—';
  const s = sign ? (v > 0 ? '+' : '') : '';
  return `${s}${v.toFixed(1)}%`;
};

// 14 swatches; consistent across charts.
const PALETTE = [
  '#1c1917', '#00E5FF', '#0891b2', '#65a30d', '#7c3aed',
  '#dc2626', '#0d9488', '#a16207', '#4338ca', '#be123c',
  '#15803d', '#9333ea', '#ea580c', '#1e40af',
];
const colorFor = (idx: number) => PALETTE[idx % PALETTE.length];

// ---------- types ----------
interface MonthlyRow { month: string; money_in: number; money_out: number; net: number; transactions: number; }
interface CategoryRow { category: string; amount: number; transactions: number; }
interface MerchantRow { merchant: string; amount: number; transactions: number; first_seen: string; last_seen: string; }
interface DailyRow { date: string; money_in: number; money_out: number; net: number; transactions: number; }
interface WeekdayRow { dow: number; name: string; amount: number; transactions: number; }
interface CategoryTrend {
  months: string[];
  categories: string[];
  series: Array<Record<string, string | number>>;
}
interface SummaryRow {
  month: string | null;
  start?: string | null;
  end?: string | null;
  range_mode?: boolean;
  days_in_range?: number | null;
  avg_per_month?: number | null;
  daily_avg?: number | null;
  money_in: number;
  money_out: number;
  net: number;
  transactions: number;
  biggest_expense: { transaction_date: string; payee: string; amount: number; category: string } | null;
  prev_money_out?: number | null;
  prev_month_money_out?: number | null;
  twelve_month_avg_money_out?: number | null;
  vs_prior_pct?: number | null;
  mom_delta_pct?: number | null;
  vs_avg_pct?: number | null;
}
interface Insight {
  kind: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
  category?: string;
  merchant?: string;
}
interface InsightsResp {
  month: string | null;
  insights: Insight[];
  movers: Array<{ category: string; current: number; previous: number; delta: number; delta_pct: number | null }>;
  new_merchants: Array<{ merchant: string; amount: number; transactions: number }>;
}
interface Txn {
  id: number;
  transaction_date: string;
  payee: string | null;
  amount: number;
  category: string | null;
  account_name: string | null;
  description: string | null;
  currency: string | null;
  project_id?: number | null;
  project_name?: string | null;
}

// ---------- helpers ----------
const fmtMonth = (m: string) => {
  const [y, mm] = m.split('-');
  return new Date(parseInt(y), parseInt(mm) - 1, 1).toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
};
const fmtMonthLong = (m: string) => {
  const [y, mm] = m.split('-');
  return new Date(parseInt(y), parseInt(mm) - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
};

// ---------- range presets ----------
type RangePreset = 'this-mo' | 'last-mo' | 'last-3mo' | 'last-6mo' | 'last-12mo' | 'ytd' | 'custom';
const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'this-mo',    label: 'This mo' },
  { value: 'last-mo',    label: 'Last mo' },
  { value: 'last-3mo',   label: 'Last 3mo' },
  { value: 'last-6mo',   label: 'Last 6mo' },
  { value: 'last-12mo',  label: 'Last 12mo' },
  { value: 'ytd',        label: 'YTD' },
  { value: 'custom',     label: 'Custom' },
];

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

// ---------- sort ----------
type CategorySortKey = 'amount' | 'category' | 'transactions';
type MerchantSortKey = 'amount' | 'merchant' | 'transactions' | 'last_seen';

// ---------- main page ----------
const ExpenseAnalysis = () => {
  const income = useIncome();
  // Filters
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string>(''); // '' = all
  // Time-range model (replaces single-month dropdown). Default: Last 3 months
  // — the smallest window where category drift becomes visible above month-to-
  // month noise. Persisted so the user's pick sticks across visits.
  const [rangePreset, setRangePreset] = usePersistentState<RangePreset>('expenses.rangePreset', 'last-3mo');
  const [customStart, setCustomStart] = usePersistentState<string>('expenses.customStart', '');
  const [customEnd, setCustomEnd] = usePersistentState<string>('expenses.customEnd', '');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [projectId, setProjectId] = useState<string>(''); // '' = all; 'untagged' = NULL; numeric = that id

  // Sort state for the categories + merchants tables (txn list has its own).
  const [catSortKey, setCatSortKey] = useState<CategorySortKey>('amount');
  const [catSortAsc, setCatSortAsc] = useState(false);
  const [merchSortKey, setMerchSortKey] = useState<MerchantSortKey>('amount');
  const [merchSortAsc, setMerchSortAsc] = useState(false);

  // Per-period detail
  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [insights, setInsights] = useState<InsightsResp | null>(null);
  const [trend, setTrend] = useState<CategoryTrend | null>(null);
  const [weekday, setWeekday] = useState<WeekdayRow[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [sortKey, setSortKey] = useState<keyof Txn>('transaction_date');
  const [sortAsc, setSortAsc] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Derive concrete start/end + label + isSingleMonth from the preset.
  // isSingleMonth = exactly one calendar month (this/last/custom-1mo). Used to
  // decide whether the daily heatmap card renders — a calendar grid isn't
  // meaningful across multiple months.
  const range = useMemo(() => {
    const today = new Date();
    let start: Date, end: Date, label: string, isSingleMonth = false, focusMonth: string | null = null;
    switch (rangePreset) {
      case 'this-mo':
        start = startOfMonth(today); end = endOfMonth(today);
        label = 'This month'; isSingleMonth = true;
        focusMonth = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
        break;
      case 'last-mo': {
        const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        start = startOfMonth(prev); end = endOfMonth(prev);
        label = 'Last month'; isSingleMonth = true;
        focusMonth = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
        break;
      }
      case 'last-3mo':
        start = startOfMonth(new Date(today.getFullYear(), today.getMonth() - 2, 1));
        end = endOfMonth(today); label = 'Last 3 months'; break;
      case 'last-6mo':
        start = startOfMonth(new Date(today.getFullYear(), today.getMonth() - 5, 1));
        end = endOfMonth(today); label = 'Last 6 months'; break;
      case 'last-12mo':
        start = startOfMonth(new Date(today.getFullYear(), today.getMonth() - 11, 1));
        end = endOfMonth(today); label = 'Last 12 months'; break;
      case 'ytd':
        start = new Date(today.getFullYear(), 0, 1); end = today;
        label = `YTD ${today.getFullYear()}`; break;
      case 'custom':
        start = customStart ? new Date(customStart) : startOfMonth(new Date(today.getFullYear(), today.getMonth() - 2, 1));
        end = customEnd ? new Date(customEnd) : today;
        label = `${isoDate(start)} → ${isoDate(end)}`;
        // Detect single-month custom range
        if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()
          && start.getDate() === 1 && end.getDate() === endOfMonth(end).getDate()) {
          isSingleMonth = true;
          focusMonth = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
        }
        break;
      default: start = today; end = today; label = '';
    }
    const daysInRange = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
    return {
      start: isoDate(start),
      end: isoDate(end),
      label,
      isSingleMonth,
      focusMonth,
      daysInRange,
      monthsCount: Math.max(1, Math.round(daysInRange / 30.44)),
    };
  }, [rangePreset, customStart, customEnd]);

  // Initial load: shell data only (accounts, projects, 24mo bar). The detail
  // useEffect below picks up `range` and fetches everything else.
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);
      try {
        const [mRes, aRes, pRes] = await Promise.all([
          fetch('/api/expenses/monthly?months=24'),
          fetch('/api/accounts'),
          fetch('/api/projects'),
        ]);
        const m: MonthlyRow[] = mRes.ok ? await mRes.json() : [];
        const a: Account[] = aRes.ok ? await aRes.json() : [];
        const p: ProjectOpt[] = pRes.ok ? await pRes.json() : [];
        setMonthly(m);
        setAccounts(a);
        setProjects(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Load failed');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // Quick project-tag handler for inline action.
  const tagTxnToProject = async (txnId: number, projectId: number | null) => {
    try {
      const res = await fetch('/api/transactions/tag-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_ids: [txnId], project_id: projectId }),
      });
      if (!res.ok) throw new Error(`Tag failed (${res.status})`);
      // Update local state without full refetch.
      setTxns(prev => prev.map(t =>
        t.id === txnId
          ? { ...t, project_id: projectId, project_name: projectId ? projects.find(p => p.id === projectId)?.name ?? null : null }
          : t
      ));
      // Refetch projects list so their totals update.
      fetch('/api/projects').then(r => r.ok ? r.json() : []).then(setProjects);
    } catch (e) {
      console.error('Tag failed', e);
    }
  };

  // When range, account, or project changes, reload everything below the fold.
  //
  // Time range: every aggregation endpoint that supports start/end uses them
  // (summary, by-category, by-merchant, daily, insights). Endpoints that take
  // a "trailing N months" count (category-trend, weekday) stay at their default
  // 12-mo backdrop — these are *trend* views, decoupled from the active range
  // so the user always has long-context comparison even when filtering down.
  // Project filter values:
  //   ''          → no filter (all projects, all untagged)
  //   'untagged'  → only NULL project_id
  //   <numeric>   → that project_id only
  useEffect(() => {
    const acct = accountId ? `&account_id=${accountId}` : '';
    const proj = projectId === 'untagged'
      ? '&untagged_only=true'
      : projectId
        ? `&project_id=${projectId}`
        : '';
    const filt = `${acct}${proj}`;
    const rangeQS = `start=${range.start}&end=${range.end}`;
    Promise.all([
      fetch(`/api/expenses/summary?${rangeQS}${filt}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/expenses/by-category?${rangeQS}${filt}`).then(r => r.ok ? r.json() : []),
      fetch(`/api/expenses/by-merchant?${rangeQS}&limit=20${filt}`).then(r => r.ok ? r.json() : []),
      fetch(`/api/expenses/daily?${rangeQS}${filt}`).then(r => r.ok ? r.json() : []),
      fetch(`/api/expenses/insights?${rangeQS}${filt}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/expenses/category-trend?months=12${filt}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/expenses/weekday?months=12${filt}`).then(r => r.ok ? r.json() : []),
      fetch(`/api/expenses/monthly?months=24${filt}`).then(r => r.ok ? r.json() : []),
    ]).then(([s, c, m, d, i, t, w, mo]) => {
      if (s) setSummary(s);
      setCategories(c);
      setMerchants(m);
      setDaily(d);
      setInsights(i);
      setTrend(t);
      setWeekday(w);
      if (mo) setMonthly(mo);
    });
  }, [range.start, range.end, accountId, projectId]);

  // Transactions list — uses the active range for date bounds. Limit raised to
  // 1500 so a 12-mo window still returns a usable list (page-level virtualised
  // table to come in a later iteration).
  useEffect(() => {
    const params = new URLSearchParams({ start: range.start, end: range.end, limit: '1500' });
    if (selectedCategory) params.set('category', selectedCategory);
    if (accountId) params.set('account_id', accountId);
    if (projectId && projectId !== 'untagged') params.set('project_id', projectId);
    if (projectId === 'untagged') params.set('untagged_only', 'true');
    fetch(`/api/transactions?${params}`)
      .then(r => r.ok ? r.json() : { items: [] })
      .then(d => setTxns(d.items || []))
      .catch(() => setTxns([]));
  }, [range.start, range.end, selectedCategory, accountId, projectId]);

  const filteredTxns = useMemo(() => {
    let rows = txns;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(t =>
        (t.payee || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q)
      );
    }
    const sorted = [...rows].sort((a, b) => {
      const av = a[sortKey] as any;
      const bv = b[sortKey] as any;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [txns, search, sortKey, sortAsc]);

  // Per-category 12-month trend (sparkline data) keyed by category.
  const categorySparks = useMemo(() => {
    if (!trend) return {};
    const out: Record<string, number[]> = {};
    trend.categories.forEach(cat => {
      out[cat] = trend.series.map(s => Number(s[cat] || 0));
    });
    return out;
  }, [trend]);

  if (loading) return <div className="p-6"><Skeleton /></div>;
  if (error) return <div className="p-6"><ErrorState message={error} /></div>;
  if (!summary) return <div className="p-6 text-stone-500 dark:text-stone-400">No transactions yet.</div>;

  const accountName = accountId
    ? accounts.find(a => String(a.id) === accountId)?.name || 'Account'
    : 'All accounts';
  // Selected project name for the header subtitle (shows what the user is
  // looking at without forcing them to scroll back to the filter bar).
  const projectName = projectId === 'untagged'
    ? 'Untagged only'
    : projectId
      ? projects.find(p => String(p.id) === projectId)?.name || 'Project'
      : 'All projects';
  const hasActiveFilters = !!(accountId || projectId || selectedCategory);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* ===== Header ===== */}
      <div>
        <h1 className="text-3xl text-stone-900 dark:text-stone-50">Expense Analysis</h1>
        <p className="text-base text-stone-500 dark:text-stone-400">
          {range.label} · {accountName} · {projectName} · {summary.transactions.toLocaleString()} transactions
        </p>
      </div>

      {/* ===== Sticky filter bar =====
          Time-range chip group is the primary control (replaces the old single-
          month dropdown). All charts/tables aggregate over the selected range.
          Account + project + category remain single-select with a chip-row for
          the active state — multi-select is a Phase-2 upgrade once we see how
          the chip pattern feels in practice. */}
      <div className="sticky top-0 z-20 -mx-6 px-6 py-3 bg-stone-50/95 dark:bg-stone-950/95 backdrop-blur border-b border-stone-200 dark:border-stone-800 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="w-4 h-4 text-stone-500 dark:text-stone-400" aria-hidden="true" />
          <span className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 mr-1">Range</span>
          <div role="group" aria-label="Time range" className="inline-flex flex-wrap gap-1">
            {RANGE_OPTIONS.map(opt => {
              const active = rangePreset === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRangePreset(opt.value)}
                  aria-pressed={active}
                  className={`px-2.5 py-1 text-xs font-mono uppercase tracking-wider rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 ${
                    active
                      ? 'border-cyan-500 text-cyan-600 dark:text-cyan-300 bg-cyan-50/60 dark:bg-cyan-900/20'
                      : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:border-stone-300 dark:hover:border-stone-600'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {rangePreset === 'custom' && (
            <span className="inline-flex items-center gap-1 ml-1">
              <input
                type="date"
                value={customStart || range.start}
                onChange={(e) => setCustomStart(e.target.value)}
                aria-label="Custom range start"
                className="px-2 py-1 text-xs border border-stone-200 dark:border-stone-700 rounded bg-white dark:bg-stone-900"
              />
              <span className="text-xs text-stone-500">→</span>
              <input
                type="date"
                value={customEnd || range.end}
                onChange={(e) => setCustomEnd(e.target.value)}
                aria-label="Custom range end"
                className="px-2 py-1 text-xs border border-stone-200 dark:border-stone-700 rounded bg-white dark:bg-stone-900"
              />
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            aria-label="Filter by account"
            className="px-3 py-1.5 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
          >
            <option value="">All accounts</option>
            {accounts.filter(a => a.type !== 'investment').map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            aria-label="Filter by project"
            className="px-3 py-1.5 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
          >
            <option value="">All projects</option>
            <option value="untagged">Untagged only</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.transaction_count})</option>
            ))}
          </select>
          {selectedCategory && (
            <button
              type="button"
              onClick={() => setSelectedCategory('')}
              className="px-2 py-1 text-xs rounded-full bg-cyan-100 dark:bg-cyan-800/40 text-cyan-700 dark:text-cyan-200 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
            >
              Category: {selectedCategory} ✕
            </button>
          )}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => { setAccountId(''); setProjectId(''); setSelectedCategory(''); }}
              className="ml-auto px-2 py-1 text-xs font-mono uppercase tracking-wider text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
            >
              Reset filters
            </button>
          )}
        </div>
      </div>

      {/* ===== Net cashflow headline =====
          Coverage ratio uses LIVING spend (baseline_living from /api/advisor/
          runway), not gross money_out — gross includes investment moves and
          project spend on Acacia/Lind which would falsely suggest income
          covers <30% when in fact income covers 120% of recurring living
          burn.  The non-living delta is shown separately so the user sees
          where the drawdown is actually going. */}
      {!income.loading && income.total_monthly > 0 && (() => {
        const livingSpend = income.baseline_living;
        const coverage = livingSpend > 0 ? (income.total_monthly / livingSpend) * 100 : 0;
        const livingNet = income.total_monthly - livingSpend;
        const nonLiving = Math.max(0, summary.money_out - livingSpend);
        return (
          <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 border-l-2 border-l-cyan-500 p-5">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
                Coverage ratio · living
              </div>
              <div className={`text-2xl tabular-nums ${coverage >= 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                Income covers {coverage.toFixed(0)}% of recurring living spend
              </div>
            </div>
            <div className="mt-1 text-base text-stone-700 dark:text-stone-300 tabular-nums">
              {fmtAud(income.total_monthly)} in · {fmtAud(livingSpend)} living out · net living
              <span className={`ml-1 ${livingNet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {livingNet >= 0 ? '+' : ''}{fmtAud(livingNet)}
              </span>
            </div>
            {nonLiving > 0 && (
              <div className="mt-1 text-xs font-mono tabular-nums text-stone-500 dark:text-stone-400">
                + {fmtAud(nonLiving)} this month in investment / project moves (drawdown, by design)
              </div>
            )}
          </div>
        );
      })()}

      {/* ===== AI Spending Forecast ===== */}
      <SpendingForecastCard />

      {/* ===== KPI cards =====
          Strip adapts to range. Single-month range keeps the legacy "MoM /
          12-mo avg" comparison; multi-month range swaps to "Avg / mo · Daily
          avg · vs prior period" so the user sees the right size of context. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<TrendingDown className="w-4 h-4 text-rose-600" />}
          label={summary.range_mode ? 'Total spend' : 'Money Out'}
          value={fmtAud(summary.money_out)}
          delta={summary.range_mode ? (summary.vs_prior_pct ?? undefined) : (summary.mom_delta_pct ?? undefined)}
          deltaLabel={summary.range_mode ? 'vs prior' : 'MoM'}
          inverted
        />
        {summary.range_mode ? (
          <KpiCard
            icon={<Receipt className="w-4 h-4 text-cyan-500" />}
            label="Avg / mo"
            value={fmtAud(summary.avg_per_month ?? 0)}
            sub={`over ${range.monthsCount} mo${range.monthsCount === 1 ? '' : 's'}`}
          />
        ) : (
          <KpiCard
            icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
            label="Money In"
            value={fmtAud(summary.money_in)}
            sub={`${summary.transactions} txns`}
          />
        )}
        <KpiCard
          icon={<Receipt className="w-4 h-4 text-cyan-500" />}
          label={summary.range_mode ? 'Daily avg' : 'Net (txn-level)'}
          value={summary.range_mode
            ? fmtAud(summary.daily_avg ?? 0)
            : fmtAud(summary.net)}
          sub={summary.range_mode ? `${summary.transactions} txns` : undefined}
          accent={summary.range_mode ? undefined : (summary.net >= 0 ? 'text-emerald-600' : 'text-rose-600')}
        />
        {summary.range_mode ? (
          <KpiCard
            icon={<Sparkles className="w-4 h-4 text-stone-600 dark:text-stone-400" />}
            label="Money in"
            value={fmtAud(summary.money_in)}
            sub={`net ${summary.net >= 0 ? '+' : ''}${fmtAud(summary.net)}`}
          />
        ) : (
          <KpiCard
            icon={<Sparkles className="w-4 h-4 text-stone-600 dark:text-stone-400" />}
            label="vs 12-mo avg"
            value={fmtPct(summary.vs_avg_pct)}
            sub={summary.twelve_month_avg_money_out ? `avg ${fmtAud(summary.twelve_month_avg_money_out)}` : ''}
            accent={(summary.vs_avg_pct ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}
          />
        )}
      </div>

      {/* ===== Two-column: 24-month trend + Insights ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">Last 24 months · always-on backdrop</h3>
            <span className="text-xs text-stone-500 dark:text-stone-400">click a bar to drill into that month</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={monthly.map(m => ({ ...m, label: fmtMonth(m.month) }))}
              // Recharts CategoricalChartFunc has an awkward type signature
              // shipped from the lib; existing call sites in this codebase use
              // `any` per CLAUDE.md baseline. Drill: set range to clicked month.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={(e: any) => {
                if (!e?.activeLabel) return;
                const target = monthly.find(m => fmtMonth(m.month) === e.activeLabel);
                if (!target) return;
                const [y, mn] = target.month.split('-').map(Number);
                const s = new Date(y, mn - 1, 1);
                const e2 = new Date(y, mn, 0);
                setCustomStart(isoDate(s));
                setCustomEnd(isoDate(e2));
                setRangePreset('custom');
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
              <XAxis dataKey="label" stroke="#78716c" fontSize={10} />
              <YAxis stroke="#78716c" fontSize={10} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => fmtAud2(v)} cursor={{ fill: '#ecfeff', opacity: 0.4 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="money_in" name="In" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="money_out" name="Out" fill="#f43f5e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-cyan-500" />
            <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">Insights</h3>
          </div>
          {insights && insights.insights.length > 0 ? (
            <ul className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
              {insights.insights.map((ins, i) => (
                <li
                  key={i}
                  className={`p-2 rounded-lg border-l-2 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/50 ${
                    ins.severity === 'warn' ? 'border-cyan-500 bg-cyan-50/50 dark:bg-cyan-800/10' :
                    ins.severity === 'critical' ? 'border-rose-500 bg-rose-50/50 dark:bg-rose-900/10' :
                    'border-stone-300 dark:border-stone-700'
                  }`}
                  onClick={() => ins.category && setSelectedCategory(ins.category)}
                >
                  <div className="text-base text-stone-800 dark:text-stone-100">{ins.title}</div>
                  <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{ins.detail}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-stone-500 dark:text-stone-400">Nothing notable in {range.label}.</p>
          )}
        </div>
      </div>

      {/* ===== Stacked category trend ===== */}
      {trend && trend.series.length > 0 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-5">
          <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">Category mix over time</h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trend.series.map(s => ({ ...s, label: fmtMonth(String(s.month)) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
              <XAxis dataKey="label" stroke="#78716c" fontSize={10} />
              <YAxis stroke="#78716c" fontSize={10} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => fmtAud2(v)} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {trend.categories.map((cat, i) => (
                <Area key={cat} type="monotone" dataKey={cat} stackId="1"
                  stroke={colorFor(i)} fill={colorFor(i)} fillOpacity={0.7} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ===== Daily heatmap + Weekday =====
          DailyHeatmap is calendar-shaped; only meaningful when range is exactly
          one calendar month. For multi-month ranges we hide the heatmap card
          and let weekday-avg span the full row instead. */}
      <div className={`grid grid-cols-1 ${range.isSingleMonth && range.focusMonth ? 'lg:grid-cols-3' : 'lg:grid-cols-1'} gap-4`}>
        {range.isSingleMonth && range.focusMonth && (
          <div className="lg:col-span-2 bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-5">
            <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4" /> {fmtMonthLong(range.focusMonth)} daily heatmap
            </h3>
            <DailyHeatmap month={range.focusMonth} daily={daily} />
          </div>
        )}
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-5">
          <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">Avg by weekday (12mo)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weekday}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
              <XAxis dataKey="name" stroke="#78716c" fontSize={11} />
              <YAxis stroke="#78716c" fontSize={10} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => fmtAud2(v)} />
              <Bar dataKey="amount" fill="#0891b2" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ===== Categories + Merchants =====
          Both lists are sortable now (header click = toggle direction).
          Click a category row to filter the txn list to that category. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Categories with sparklines */}
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-5">
          <div className="flex items-center justify-between mb-3 gap-2">
            <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">Categories</h3>
            <div className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
              <span>Sort:</span>
              <SortPill label="$" active={catSortKey === 'amount'} asc={catSortAsc} onClick={() => { setCatSortAsc(catSortKey === 'amount' ? !catSortAsc : false); setCatSortKey('amount'); }} />
              <SortPill label="A–Z" active={catSortKey === 'category'} asc={catSortAsc} onClick={() => { setCatSortAsc(catSortKey === 'category' ? !catSortAsc : true); setCatSortKey('category'); }} />
              <SortPill label="#" active={catSortKey === 'transactions'} asc={catSortAsc} onClick={() => { setCatSortAsc(catSortKey === 'transactions' ? !catSortAsc : false); setCatSortKey('transactions'); }} />
            </div>
          </div>
          {categories.length === 0 ? (
            <p className="text-base text-stone-500 dark:text-stone-400">No spending in {range.label}.</p>
          ) : (
            <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
              {[...categories].sort((a, b) => {
                const dir = catSortAsc ? 1 : -1;
                if (catSortKey === 'category') return a.category.localeCompare(b.category) * dir;
                return ((a[catSortKey] as number) - (b[catSortKey] as number)) * dir;
              }).map((c, i) => {
                const spark = categorySparks[c.category];
                const max = Math.max(...categories.map(x => x.amount));
                const widthPct = max > 0 ? (c.amount / max) * 100 : 0;
                const isActive = selectedCategory === c.category;
                return (
                  <button
                    key={c.category}
                    onClick={() => setSelectedCategory(prev => prev === c.category ? '' : c.category)}
                    className={`w-full text-left p-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 ${
                      isActive ? 'bg-cyan-50 dark:bg-cyan-800/30' : 'hover:bg-stone-50 dark:hover:bg-stone-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-base">
                      <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colorFor(i) }} />
                        <span className="text-stone-700 dark:text-stone-200">{c.category}</span>
                        <span className="text-xs text-stone-400">({c.transactions})</span>
                      </span>
                      <span className="text-stone-800 dark:text-stone-100 tabular-nums">
                        {fmtAud(c.amount)}
                        {income.total_monthly > 0 && range.isSingleMonth && (
                          <span className="ml-2 text-xs text-stone-500 dark:text-stone-400">
                            · {((c.amount / income.total_monthly) * 100).toFixed(0)}% of income
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1 bg-stone-100 dark:bg-stone-800 rounded">
                        <div className="h-1 rounded" style={{ width: `${widthPct}%`, backgroundColor: colorFor(i) }} />
                      </div>
                      {spark && spark.length > 1 && (
                        <Sparkline values={spark} color={colorFor(i)} width={64} height={18} />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Top merchants */}
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-5">
          <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">
            Top merchants {selectedCategory && <span className="text-base font-normal text-cyan-500">in {selectedCategory}</span>}
          </h3>
          {merchants.length === 0 ? (
            <p className="text-base text-stone-500 dark:text-stone-400">No merchants in {range.label}.</p>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-base">
                <thead className="text-xs text-stone-500 dark:text-stone-400 uppercase border-b border-stone-200 dark:border-stone-800 sticky top-0 bg-white dark:bg-stone-900">
                  <tr>
                    <th className="text-left py-2 ">
                      <SortBtn label="Merchant" active={merchSortKey === 'merchant'} asc={merchSortAsc}
                        onClick={() => { setMerchSortAsc(merchSortKey === 'merchant' ? !merchSortAsc : true); setMerchSortKey('merchant'); }} />
                    </th>
                    <th className="text-right py-2">
                      <SortBtn label="Amount" active={merchSortKey === 'amount'} asc={merchSortAsc} align="right"
                        onClick={() => { setMerchSortAsc(merchSortKey === 'amount' ? !merchSortAsc : false); setMerchSortKey('amount'); }} />
                    </th>
                    <th className="text-right py-2">
                      <SortBtn label="#" active={merchSortKey === 'transactions'} asc={merchSortAsc} align="right"
                        onClick={() => { setMerchSortAsc(merchSortKey === 'transactions' ? !merchSortAsc : false); setMerchSortKey('transactions'); }} />
                    </th>
                    <th className="text-right py-2">
                      <SortBtn label="Last seen" active={merchSortKey === 'last_seen'} asc={merchSortAsc} align="right"
                        onClick={() => { setMerchSortAsc(merchSortKey === 'last_seen' ? !merchSortAsc : false); setMerchSortKey('last_seen'); }} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...merchants].sort((a, b) => {
                    const dir = merchSortAsc ? 1 : -1;
                    if (merchSortKey === 'merchant') return a.merchant.localeCompare(b.merchant) * dir;
                    if (merchSortKey === 'last_seen') return a.last_seen.localeCompare(b.last_seen) * dir;
                    return ((a[merchSortKey] as number) - (b[merchSortKey] as number)) * dir;
                  }).map(m => (
                    <tr key={m.merchant} className="border-b border-stone-100 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800/50">
                      <td className="py-2 text-stone-700 dark:text-stone-200 truncate max-w-[200px]" title={m.merchant}>{m.merchant}</td>
                      <td className="py-2 text-right text-stone-800 dark:text-stone-100 tabular-nums">{fmtAud(m.amount)}</td>
                      <td className="py-2 text-right text-stone-500 dark:text-stone-400 tabular-nums">{m.transactions}</td>
                      <td className="py-2 text-right text-stone-500 dark:text-stone-400 tabular-nums whitespace-nowrap">{m.last_seen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ===== Movers + new merchants ===== */}
      {insights && (insights.movers.length > 0 || insights.new_merchants.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-5">
            <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">
              Top movers vs prior {summary.range_mode ? 'period' : 'month'}
            </h3>
            <table className="w-full text-base">
              <thead className="text-xs text-stone-500 dark:text-stone-400 uppercase">
                <tr>
                  <th className="text-left py-1 ">Category</th>
                  <th className="text-right ">Prev</th>
                  <th className="text-right ">Now</th>
                  <th className="text-right ">Δ</th>
                </tr>
              </thead>
              <tbody>
                {insights.movers.slice(0, 8).map(m => (
                  <tr
                    key={m.category}
                    className="border-b border-stone-100 dark:border-stone-800 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/50"
                    onClick={() => setSelectedCategory(m.category)}
                  >
                    <td className="py-2 text-stone-700 dark:text-stone-200">{m.category}</td>
                    <td className="py-2 text-right text-stone-500 dark:text-stone-400">{fmtAud(m.previous)}</td>
                    <td className="py-2 text-right text-stone-700 dark:text-stone-200">{fmtAud(m.current)}</td>
                    <td className={`py-2 text-right ${m.delta > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {fmtPct(m.delta_pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-5">
            <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">
              New merchants this {summary.range_mode ? 'period' : 'month'}
            </h3>
            {insights.new_merchants.length === 0 ? (
              <p className="text-base text-stone-500 dark:text-stone-400">No new merchants.</p>
            ) : (
              <ul className="space-y-1.5 text-base">
                {insights.new_merchants.slice(0, 8).map(nm => (
                  <li key={nm.merchant} className="flex items-center justify-between border-b border-stone-100 dark:border-stone-800 pb-1.5">
                    <span className="text-stone-700 dark:text-stone-200">{nm.merchant}</span>
                    <span className="text-stone-800 dark:text-stone-100 ">{fmtAud(nm.amount)} <span className="text-xs text-stone-400">({nm.transactions})</span></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ===== Transactions ===== */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">
            Transactions
            {selectedCategory && <span className="ml-2 text-cyan-500 text-base font-normal">· {selectedCategory}</span>}
          </h3>
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-stone-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search merchant, category, description…"
              className="px-3 py-1.5 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base w-72"
            />
          </div>
        </div>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-base">
            <thead className="text-xs text-stone-500 dark:text-stone-400 uppercase border-b border-stone-200 dark:border-stone-800 sticky top-0 bg-white dark:bg-stone-900 z-10">
              <tr>
                <SortHead label="Date" k="transaction_date" sortKey={sortKey} sortAsc={sortAsc} onSort={(k) => { setSortAsc(sortKey === k ? !sortAsc : false); setSortKey(k); }} />
                <SortHead label="Merchant" k="payee" sortKey={sortKey} sortAsc={sortAsc} onSort={(k) => { setSortAsc(sortKey === k ? !sortAsc : true); setSortKey(k); }} />
                <SortHead label="Category" k="category" sortKey={sortKey} sortAsc={sortAsc} onSort={(k) => { setSortAsc(sortKey === k ? !sortAsc : true); setSortKey(k); }} />
                <th className="text-left py-2 ">Account</th>
                <th className="text-left py-2 "><Hammer className="w-3 h-3 inline" /></th>
                <SortHead label="Amount" k="amount" sortKey={sortKey} sortAsc={sortAsc} onSort={(k) => { setSortAsc(sortKey === k ? !sortAsc : false); setSortKey(k); }} align="right" />
              </tr>
            </thead>
            <tbody>
              {filteredTxns.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-stone-500 dark:text-stone-400">
                  No transactions match.{(search || selectedCategory) && (
                    <button onClick={() => { setSearch(''); setSelectedCategory(''); }} className="ml-2 text-cyan-500 hover:underline">Clear filters</button>
                  )}
                </td></tr>
              ) : filteredTxns.map(t => (
                <tr key={t.id} className="border-b border-stone-100 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800/50 group">
                  <td className="py-2 text-stone-500 dark:text-stone-400 whitespace-nowrap">{t.transaction_date}</td>
                  <td className="py-2 text-stone-700 dark:text-stone-200 truncate max-w-[280px]" title={t.description || t.payee || ''}>{t.payee || '—'}</td>
                  <td className="py-2 text-stone-500 dark:text-stone-400">{t.category || '—'}</td>
                  <td className="py-2 text-stone-500 dark:text-stone-400 text-xs">{t.account_name || '—'}</td>
                  <td className="py-2">
                    <select
                      value={t.project_id ?? ''}
                      onChange={(e) => tagTxnToProject(t.id, e.target.value ? parseInt(e.target.value) : null)}
                      className={`text-xs px-1.5 py-0.5 rounded border ${t.project_id ? 'bg-cyan-50 border-cyan-300 text-cyan-700 dark:bg-cyan-800/30 dark:text-cyan-200' : 'bg-transparent border-stone-200 text-stone-400 dark:border-stone-700 opacity-0 group-hover:opacity-100 transition-opacity'}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <option value="">—</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className={`py-2 text-right whitespace-nowrap ${t.amount < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {fmtAud2(t.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mt-2">
          Showing {filteredTxns.length} of {txns.length} for {range.label}.
          Spend total: <span className="text-stone-700 dark:text-stone-300">
            {fmtAud(filteredTxns.filter(t => t.amount < 0).reduce((s, t) => s + -t.amount, 0))}
          </span>
        </p>
      </div>
    </div>
  );
};

// ---------- subcomponents ----------
interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  delta?: number;
  deltaLabel?: string;
  inverted?: boolean; // for spending: up is bad (red)
  accent?: string;
}
const KpiCard = ({ icon, label, value, sub, delta, deltaLabel, inverted, accent }: KpiCardProps) => {
  const Arrow = delta == null ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  const deltaCls = delta == null ? 'text-stone-400'
    : (inverted ? (delta > 0 ? 'text-rose-600' : 'text-emerald-600')
                : (delta > 0 ? 'text-emerald-600' : 'text-rose-600'));
  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4">
      <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 mb-1">{icon}<span>{label}</span></div>
      <div className={`text-2xl font-semibold ${accent || 'text-stone-800 dark:text-stone-100'}`}>{value}</div>
      {(sub || delta != null) && (
        <div className="flex items-center gap-2 mt-1 text-xs">
          {delta != null && (
            <span className={`inline-flex items-center gap-0.5 ${deltaCls} font-medium`}>
              <Arrow className="w-3 h-3" />
              {fmtPct(delta, false)}
              {deltaLabel && <span className="text-stone-400 font-normal ml-1">{deltaLabel}</span>}
            </span>
          )}
          {sub && <span className="text-stone-500 dark:text-stone-400 truncate">{sub}</span>}
        </div>
      )}
    </div>
  );
};

interface SortHeadProps {
  label: string;
  k: keyof Txn;
  sortKey: keyof Txn;
  sortAsc: boolean;
  onSort: (k: keyof Txn) => void;
  align?: 'left' | 'right';
}
const SortHead = ({ label, k, sortKey, sortAsc, onSort, align = 'left' }: SortHeadProps) => (
  <th className={`py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
    <button onClick={() => onSort(k)} className="inline-flex items-center gap-0.5 hover:text-stone-700 dark:text-stone-300 dark:hover:text-stone-300">
      {label}
      {sortKey === k && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
    </button>
  </th>
);

// SortPill: compact mono pill for the categories list ($, A–Z, # buttons).
// SortBtn: column-header style for the merchants table.
const SortPill = ({ label, active, asc, onClick }: { label: string; active: boolean; asc: boolean; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 ${
      active
        ? 'border-cyan-500 text-cyan-600 dark:text-cyan-300'
        : 'border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'
    }`}
  >
    {label}
    {active && (asc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
  </button>
);

const SortBtn = ({ label, active, asc, onClick, align = 'left' }: { label: string; active: boolean; asc: boolean; onClick: () => void; align?: 'left' | 'right' }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`inline-flex items-center gap-0.5 ${align === 'right' ? 'flex-row-reverse' : ''} hover:text-stone-700 dark:hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded`}
  >
    {label}
    {active && (asc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
  </button>
);

// Inline SVG sparkline.
const Sparkline = ({ values, color, width = 60, height = 16 }: { values: number[]; color: string; width?: number; height?: number }) => {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => `${i * step},${height - ((v - min) / range) * height}`).join(' ');
  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.2} />
    </svg>
  );
};

// Daily heatmap — calendar grid of money_out per day for the selected month.
const DailyHeatmap = ({ month, daily }: { month: string; daily: DailyRow[] }) => {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDow = new Date(y, m - 1, 1).getDay(); // 0 = Sun
  const byDate = new Map(daily.map(d => [d.date, d]));
  const max = Math.max(...daily.map(d => d.money_out), 1);

  // Build weeks (each row = 7 cells, Sun → Sat).
  const cells: Array<{ date: string | null; out: number; n: number; net: number } | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const row = byDate.get(date);
    cells.push({ date, out: row?.money_out ?? 0, n: row?.transactions ?? 0, net: row?.net ?? 0 });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-xs text-stone-400 mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <div key={i} />;
          const intensity = c.out / max; // 0..1
          const bg = c.out > 0
            ? `rgba(244, 63, 94, ${0.15 + intensity * 0.7})` // rose at varying intensity
            : 'rgba(231, 229, 228, 0.4)';
          return (
            <div
              key={i}
              className="aspect-square rounded text-xs flex flex-col items-center justify-center text-stone-700 dark:text-stone-200"
              style={{ backgroundColor: bg }}
              title={`${c.date}: out ${fmtAud(c.out)}, in $${(c.net + c.out).toLocaleString('en-AU', { maximumFractionDigits: 0 })}, ${c.n} txns`}
            >
              <span className="leading-tight ">{c.date && c.date.split('-')[2]}</span>
              {c.out > 0 && <span className="text-xs opacity-80 leading-none">${Math.round(c.out)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// AI Spending Forecast card
//
// Reads /api/intel/spending-forecast — per-category OLS projection over next
// 6 months, with Investment/Transfers excluded because those are asset moves,
// not living burn. Shows top accelerating/easing categories + Kimi narrative
// on the fastest grower.
// ============================================================================
interface ForecastCategory {
  category: string;
  window_avg_monthly_aud: number;
  last_month_aud: number;
  slope_aud_per_month: number;
  projected_next_month_aud: number;
  projected_6mo_total_aud: number;
  pct_change_vs_window_avg: number;
  direction: 'stable' | 'accelerating' | 'easing';
}
interface ForecastResp {
  as_of: string;
  window_months: number;
  horizon_months: number;
  categories: ForecastCategory[];
  total_window_monthly_aud: number;
  total_projected_monthly_aud: number;
  total_projected_6mo_aud: number;
  accelerating_count: number;
  easing_count: number;
  fastest_grower: ForecastCategory | null;
  narrative: string;
  narrative_provider: string;
  error?: string;
  // Iteration 22 cache-meta. See src/lib/aiCache.ts.
  cached?: false;
  _cached_at?: string | null;
  _age_seconds?: number;
  _stale?: boolean;
}

const directionIconCls = (d: ForecastCategory['direction']) =>
  d === 'accelerating' ? 'text-rose-600 dark:text-rose-400' :
  d === 'easing'       ? 'text-emerald-600 dark:text-emerald-400' :
                         'text-stone-500 dark:text-stone-400';

const SpendingForecastCard = () => {
  const [data, setData] = useState<ForecastResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Iteration 22 manual gating.
  const load = async (mode: 'mount' | 'fresh' = 'mount') => {
    setLoading(true); setErr(null);
    try {
      const qs = mode === 'fresh' ? '?force=true' : '?cache_only=true';
      const res = await fetch(`/api/intel/spending-forecast${qs}`);
      if (!res.ok) throw new Error(`spending-forecast ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  };
  useEffect(() => { load('mount'); }, []);
  const noCache = data?.cached === false;

  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 border-l-cyan-500 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
          <Sparkles className="w-3.5 h-3.5 text-cyan-500" /> AI Spending Forecast
          {data && !noCache && data.narrative_provider && (
            <span className="text-stone-400 dark:text-stone-500">· via {data.narrative_provider}</span>
          )}
          {data && !noCache && data.window_months > 0 && (
            <span className="text-stone-400 dark:text-stone-500">· {data.window_months}mo in → {data.horizon_months}mo out</span>
          )}
          {data?._cached_at && data?._age_seconds != null && (
            <span className={data._stale ? 'text-amber-500 dark:text-amber-400' : 'text-stone-400 dark:text-stone-500'}>
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
          {loading ? 'Forecasting' : (noCache ? 'Run analysis' : 'Re-run')}
        </button>
      </div>

      {err ? (
        <ErrorState title="Forecast unavailable" message={err} onRetry={() => load('fresh')} />
      ) : noCache ? (
        <p className="text-base text-stone-500 dark:text-stone-400">
          No forecast yet — click <span className="text-cyan-600 dark:text-cyan-400">Run analysis</span> to extrapolate per-category spend over the next 6 months and surface the fastest-growing line.
        </p>
      ) : !data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          {/* Summary strip */}
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-4">
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">Projected next month</div>
              <div className="text-2xl font-mono tabular-nums text-stone-900 dark:text-stone-50">{fmtAud(data.total_projected_monthly_aud)}</div>
              <div className="text-xs font-mono tabular-nums text-stone-500 dark:text-stone-400">vs 6-mo avg {fmtAud(data.total_window_monthly_aud)}</div>
            </div>
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">Next 6 months total</div>
              <div className="text-2xl font-mono tabular-nums text-stone-900 dark:text-stone-50">{fmtAud(data.total_projected_6mo_aud)}</div>
            </div>
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">Trends</div>
              <div className="text-base text-stone-900 dark:text-stone-50">
                <span className="text-rose-600 dark:text-rose-400">{data.accelerating_count} ↑</span>
                <span className="text-stone-400 dark:text-stone-500 mx-1">·</span>
                <span className="text-emerald-600 dark:text-emerald-400">{data.easing_count} ↓</span>
              </div>
            </div>
          </div>

          {/* Top categories by projected 6mo */}
          <table className="min-w-full text-base mb-4">
            <thead>
              <tr className="border-b border-stone-200 dark:border-stone-800 text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
                <th className="text-left py-2">Category</th>
                <th className="text-right py-2">6-mo avg</th>
                <th className="text-right py-2">Next mo (proj)</th>
                <th className="text-right py-2">Slope</th>
                <th className="text-left py-2 pl-3">Trend</th>
                <th className="text-right py-2">6mo forward</th>
              </tr>
            </thead>
            <tbody>
              {data.categories.slice(0, 6).map((c) => {
                const dirCls = directionIconCls(c.direction);
                return (
                  <tr key={c.category} className="border-b border-stone-100 dark:border-stone-800/60">
                    <td className="py-2.5 text-stone-900 dark:text-stone-100">{c.category}</td>
                    <td className="py-2.5 text-right tabular-nums font-mono text-stone-500 dark:text-stone-400">{fmtAud(c.window_avg_monthly_aud)}</td>
                    <td className="py-2.5 text-right tabular-nums font-mono text-stone-900 dark:text-stone-100">{fmtAud(c.projected_next_month_aud)}</td>
                    <td className={`py-2.5 text-right tabular-nums font-mono ${dirCls}`}>
                      {c.slope_aud_per_month >= 0 ? '+' : ''}{fmtAud(c.slope_aud_per_month)}/mo
                    </td>
                    <td className={`py-2.5 pl-3 text-xs font-mono uppercase tracking-wider ${dirCls}`}>
                      {c.direction === 'accelerating' && <ArrowUpRight className="inline w-3 h-3 mr-0.5" />}
                      {c.direction === 'easing' && <ArrowDownRight className="inline w-3 h-3 mr-0.5" />}
                      {c.direction === 'stable' && <Minus className="inline w-3 h-3 mr-0.5" />}
                      {c.direction}
                    </td>
                    <td className="py-2.5 text-right tabular-nums font-mono text-stone-900 dark:text-stone-100">{fmtAud(c.projected_6mo_total_aud)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Kimi narrative */}
          <p className="text-base text-stone-900 dark:text-stone-100 leading-relaxed">
            {data.narrative}
          </p>
          <div className="mt-3 text-xs font-mono uppercase tracking-wider text-stone-400 dark:text-stone-500">
            Investment/Transfers excluded — those are asset moves, not living burn
          </div>
        </>
      )}
    </div>
  );
};

// Named alias — used by the consolidated `/spending` page (tab-based sub-nav).
// Iteration-17 internals untouched; this is a render-only re-export so the
// page can be embedded as a tab without duplicating logic.
export const ExpenseAnalysisView = ExpenseAnalysis;

export default ExpenseAnalysis;
