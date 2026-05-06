import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { BarChart3, TrendingUp, TrendingDown, Minus, Loader2, Info } from 'lucide-react';
import Skeleton from '../components/Skeleton';
import ErrorState from '../components/ErrorState';

type Period = 'MTD' | 'YTD' | '1M' | '3M' | '6M' | '1Y' | '3Y' | 'ALL';

interface SeriesPoint {
  date: string;
  value: number;
}

interface PerformanceResponse {
  period: Period;
  start_date?: string;
  end_date?: string;
  snapshots?: number;
  start_value?: number;
  end_value?: number;
  twr: number | null;
  irr: number | null;
  max_drawdown: number | null;
  volatility: number | null;
  series: SeriesPoint[];
  benchmark_series: SeriesPoint[];
  benchmark_symbol?: string | null;
  note?: string;
}

const PERIODS: Period[] = ['MTD', 'YTD', '1M', '3M', '6M', '1Y', '3Y', 'ALL'];

const BENCHMARKS: { value: string; label: string }[] = [
  { value: '', label: 'No benchmark' },
  { value: '^AXJO', label: 'ASX 200 (^AXJO)' },
  { value: '^GSPC', label: 'S&P 500 (^GSPC)' },
  { value: '^IXIC', label: 'Nasdaq (^IXIC)' },
  { value: '^HSI', label: 'Hang Seng (^HSI)' },
  { value: 'BTC-USD', label: 'Bitcoin (BTC-USD)' },
];

const formatPct = (v: number | null) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

const formatAud = (v: number) =>
  v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  trend?: 'up' | 'down' | 'flat';
}

const MetricCard = ({ label, value, hint, trend = 'flat' }: MetricCardProps) => {
  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const tone =
    trend === 'up'
      ? 'text-emerald-600 dark:text-emerald-400'
      : trend === 'down'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-stone-700 dark:text-stone-200';
  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-4 sm:p-6">
      <p className="text-base text-stone-500 dark:text-stone-400">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>
        <Icon className="inline w-4 h-4 mr-1 mb-1" />
        {value}
      </p>
      {hint && <p className="text-xs text-stone-500 dark:text-stone-400 mt-2">{hint}</p>}
    </div>
  );
};

const Performance = () => {
  const [period, setPeriod] = useState<Period>('ALL');
  const [benchmark, setBenchmark] = useState<string>('^AXJO');
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (data) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ period });
        if (benchmark) qs.set('benchmark', benchmark);
        const res = await fetch(`/api/performance?${qs.toString()}`);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load performance');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, benchmark]);

  const retry = () => {
    // bump the dependencies by nudging state so the effect re-runs
    setPeriod((p) => p);
    setBenchmark((b) => b);
    setError(null);
  };

  // Merge the two series on date for the overlay chart
  const chartData = useMemo(() => {
    if (!data) return [];
    const byDate = new Map<string, { date: string; portfolio?: number; benchmark?: number }>();
    for (const p of data.series) byDate.set(p.date, { date: p.date, portfolio: p.value });
    for (const p of data.benchmark_series) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row.benchmark = p.value;
      byDate.set(p.date, row);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const twrTrend: 'up' | 'down' | 'flat' =
    data?.twr == null ? 'flat' : data.twr >= 0 ? 'up' : 'down';
  const irrTrend: 'up' | 'down' | 'flat' =
    data?.irr == null ? 'flat' : data.irr >= 0 ? 'up' : 'down';
  const ddTrend: 'up' | 'down' | 'flat' =
    data?.max_drawdown == null ? 'flat' : data.max_drawdown < -0.1 ? 'down' : 'flat';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl text-stone-900 dark:text-stone-50 flex items-center gap-3">
            <BarChart3 className="w-6 h-6 text-cyan-500" />
            Performance
          </h1>
          <p className="text-base text-stone-500 dark:text-stone-400 mt-1">
            Time-weighted and money-weighted returns from actual net-worth snapshots, with an optional benchmark overlay.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex p-1 rounded-lg bg-stone-100 dark:bg-stone-800">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  period === p
                    ? 'bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 shadow-sm'
                    : 'text-stone-600 dark:text-stone-300 hover:text-stone-800 dark:hover:text-stone-100'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <select
            value={benchmark}
            onChange={(e) => setBenchmark(e.target.value)}
            className="text-base border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg px-2 py-1"
          >
            {BENCHMARKS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorState title="Couldn't load performance" message={error} onRetry={retry} />}

      {data?.note && (
        <div className="flex items-start gap-2 p-4 rounded-lg bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 border-l-cyan-500 text-base text-stone-700 dark:text-stone-300">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-cyan-500" />
          <span>{data.note}</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading && !data ? (
          <>
            <Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" />
          </>
        ) : (
          <>
            <MetricCard
              label="TWR"
              value={formatPct(data?.twr ?? null)}
              trend={twrTrend}
              hint="Time-weighted return over the period (removes cash-flow timing)"
            />
            <MetricCard
              label="IRR"
              value={formatPct(data?.irr ?? null)}
              trend={irrTrend}
              hint="Money-weighted return (p.a.)"
            />
            <MetricCard
              label="Max drawdown"
              value={formatPct(data?.max_drawdown ?? null)}
              trend={ddTrend}
              hint="Peak-to-trough over the period"
            />
            <MetricCard
              label="Volatility"
              value={data?.volatility == null ? '—' : `${(data.volatility * 100).toFixed(1)}%`}
              hint="Annualised σ of daily returns"
            />
          </>
        )}
      </div>

      <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">
            Portfolio vs {benchmark || 'benchmark'}
            <span className="ml-2 text-xs font-normal text-stone-500 dark:text-stone-400">
              (rebased to 100 at period start)
            </span>
          </h2>
          {(loading || refreshing) && <Loader2 className="w-4 h-4 animate-spin text-stone-400" />}
        </div>

        <div className="h-72 sm:h-96">
          {loading && !data ? (
            <Skeleton className="w-full h-full" />
          ) : chartData.length < 2 ? (
            <div className="flex items-center justify-center h-full text-base text-stone-500 dark:text-stone-400 text-center px-6">
              Not enough snapshots to plot a series yet — the daily sync fills this in over time.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-stone-200 dark:text-stone-800" />
                <XAxis dataKey="date" stroke="currentColor" className="text-stone-500 dark:text-stone-400" minTickGap={32} />
                <YAxis
                  stroke="currentColor" className="text-stone-500 dark:text-stone-400"
                  domain={['dataMin - 2', 'dataMax + 2']}
                  tickFormatter={(v) => (typeof v === 'number' ? v.toFixed(0) : v)}
                />
                <Tooltip
                  formatter={(value) =>
                    typeof value === 'number'
                      ? `${value.toFixed(2)} (${(value - 100 >= 0 ? '+' : '')}${(value - 100).toFixed(2)}%)`
                      : value
                  }
                  contentStyle={{ background: 'rgb(15 23 42)', border: 'none', color: 'white' }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="portfolio"
                  name="Portfolio"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
                {benchmark && (
                  <Line
                    type="monotone"
                    dataKey="benchmark"
                    name={benchmark}
                    stroke="#10b981"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    dot={false}
                    connectNulls
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {data && (
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-stone-500 dark:text-stone-400">
            {data.snapshots != null && <span>{data.snapshots} snapshot{data.snapshots === 1 ? '' : 's'}</span>}
            {data.start_date && data.end_date && (
              <span>
                {data.start_date} → {data.end_date}
              </span>
            )}
            {data.start_value != null && data.end_value != null && (
              <span>
                {formatAud(data.start_value)} → {formatAud(data.end_value)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Performance;
