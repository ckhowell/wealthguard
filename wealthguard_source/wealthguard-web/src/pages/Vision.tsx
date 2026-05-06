import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  Treemap,
  PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  BarChart, Bar,
} from 'recharts';
import {
  Eye, CalendarDays, Layers, Wallet, TrendingUp, Banknote, AlertTriangle,
} from 'lucide-react';
import SectionHeader from '../components/SectionHeader';
import { useIncome } from '../hooks/useIncome';
import type { Holding, Account } from '../types/api';

// ── WattVision palette — cyan accent only on hover; neutrals + semantic only.
const STONE_900 = '#1c1917';
const STONE_700 = '#44403c';
const STONE_500 = '#78716c';
const STONE_300 = '#d6d3d1';
const STONE_200 = '#e7e5e4';
const STONE_100 = '#f5f5f4';
const LIME = '#32D74B';

// Heatmap stops (delta vs prior month, % NW change). 7 buckets:
//  ≤−4   ≤−2   ≤−0.5  ±0.5   ≤+2   ≤+4   >+4
const heatColour = (deltaPct: number | null) => {
  if (deltaPct == null || Number.isNaN(deltaPct)) return STONE_200;
  if (deltaPct <= -4) return '#7f1d1d';
  if (deltaPct <= -2) return '#b91c1c';
  if (deltaPct <= -0.5) return '#fda4af';
  if (deltaPct <  0.5) return STONE_300;
  if (deltaPct <  2)   return '#86efac';
  if (deltaPct <  4)   return '#22c55e';
  return '#15803d';
};

const fmtAudShort = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${v < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${v < 0 ? '-' : ''}$${Math.round(abs / 1000)}k`;
  return `${v < 0 ? '-' : ''}$${Math.round(abs).toLocaleString()}`;
};
const fmtAud = (v: number) =>
  v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

interface NwHistoryRow {
  snapshot_date: string;
  net_worth: number;
  total_assets: number;
  total_liabilities: number;
  investment_value: number;
  cash_value: number;
}

interface VisionProjection {
  current: Record<string, number>;
  rates: Record<string, number>;
  series: Array<{ year: number; total: number; buckets: Record<string, number> }>;
  milestones: Array<{ name: string; amount: number }>;
}

// Rough volatility weights per class (annualised σ proxy) — for risk-contribution bar.
const RISK_SIGMA: Record<string, number> = {
  Crypto: 0.65,
  Equities: 0.18,
  'Real Estate': 0.10,
  Vehicles: 0.08,
  Cash: 0.005,
};
const RISK_PALETTE: Record<string, string> = {
  Crypto:        '#ef4444',
  Equities:      '#f59e0b',
  'Real Estate': '#a3a3a3',
  Vehicles:      '#737373',
  Cash:          '#16a34a',
};

const Vision = () => {
  const income = useIncome();
  const [history, setHistory] = useState<NwHistoryRow[] | null>(null);
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [projection, setProjection] = useState<VisionProjection | null>(null);

  useEffect(() => {
    let cancelled = false;
    const get = async (url: string) => {
      try {
        const r = await fetch(url);
        return r.ok ? await r.json() : null;
      } catch { return null; }
    };
    Promise.all([
      get('/api/net-worth/history?days=730'),
      get('/api/holdings'),
      get('/api/accounts'),
      get('/api/vision/projection?years=30'),
    ]).then(([h, hd, ac, pj]) => {
      if (cancelled) return;
      setHistory(Array.isArray(h) ? h : []);
      setHoldings(Array.isArray(hd) ? hd : []);
      setAccounts(Array.isArray(ac) ? ac : []);
      setProjection(pj);
    });
    return () => { cancelled = true; };
  }, []);

  // ── 1. NW heatmap — 24 monthly cells (most recent right).
  const heatCells = useMemo(() => {
    if (!history) return [];
    // Bucket history by YYYY-MM, take the last snapshot in each month.
    const byMonth = new Map<string, NwHistoryRow>();
    for (const row of history) {
      const ym = row.snapshot_date.slice(0, 7);
      byMonth.set(ym, row);
    }
    const sorted = Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b));
    const last24 = sorted.slice(-24);
    let prev: NwHistoryRow | null = null;
    return last24.map(([ym, row]) => {
      const deltaPct = prev && prev.net_worth > 0 ? ((row.net_worth - prev.net_worth) / prev.net_worth) * 100 : null;
      prev = row;
      return { ym, value: row.net_worth, deltaPct };
    });
  }, [history]);

  // ── 2. Asset-class treemap — bucket holdings + accounts by class.
  const treemapData = useMemo(() => {
    const buckets: Record<string, number> = {
      Cash: 0, Crypto: 0, Equities: 0, 'Real Estate': 0, Vehicles: 0,
    };
    if (holdings) {
      for (const h of holdings) {
        const v = h.value_aud || 0;
        const cls = (h.asset_class || '').toLowerCase();
        const sym = h.symbol || '';
        if (cls === 'crypto') buckets.Crypto += v;
        else if (cls === 'equity' || cls === 'etf') buckets.Equities += v;
        else if (sym.startsWith('REAL_ESTATE_')) buckets['Real Estate'] += v;
        else if (sym.startsWith('VEHICLE_')) buckets.Vehicles += v;
        else buckets['Real Estate'] += v;
      }
    }
    if (accounts) {
      for (const a of accounts) {
        if (a.type === 'savings' || a.type === 'checking') {
          buckets.Cash += a.current_balance_aud || 0;
        }
      }
    }
    return Object.entries(buckets)
      .filter(([, v]) => v > 0)
      .map(([name, size]) => ({ name, size }))
      .sort((a, b) => b.size - a.size);
  }, [holdings, accounts]);

  const totalValue = treemapData.reduce((s, b) => s + b.size, 0);

  // ── 3. Income-sources nested donut.
  const incomeOuter = useMemo(() => {
    const items = [
      { name: 'Nicole salary', value: income.nicole_monthly },
      { name: 'Interest',      value: income.interest_monthly },
      { name: 'Staking',       value: income.staking_monthly },
      { name: 'Other',         value: income.txn_income_monthly },
    ].filter((x) => x.value > 0.01);
    return items;
  }, [income]);
  const incomeInner = useMemo(() => {
    const earned = income.nicole_monthly;
    const passive = income.interest_monthly + income.staking_monthly + income.txn_income_monthly;
    return [
      { name: 'Earned', value: earned },
      { name: 'Passive', value: passive },
    ].filter((x) => x.value > 0.01);
  }, [income]);

  // ── 4. Trajectory line.
  const trajectoryData = useMemo(() => {
    if (!projection) return [];
    return projection.series.map((s) => ({
      year: s.year,
      total: s.total,
      RealEstate: s.buckets['Real Estate'] || 0,
      Cash: s.buckets.Cash || 0,
      Crypto: s.buckets.Crypto || 0,
      Equities: s.buckets.Equities || 0,
    }));
  }, [projection]);

  // ── 5. Yield-per-account pie — monthly $ income contribution.
  const yieldData = useMemo(() => {
    return income.interest_breakdown
      .filter((b) => b.monthly_aud > 0)
      .map((b) => ({ name: b.account, value: b.monthly_aud, balance: b.balance_aud, apy: b.apy_pct }))
      .sort((a, b) => b.value - a.value);
  }, [income]);
  const totalYieldMonthly = yieldData.reduce((s, b) => s + b.value, 0);

  // ── 6. Risk-contribution bar.
  const riskData = useMemo(() => {
    const rows = treemapData.map((b) => {
      const sigma = RISK_SIGMA[b.name] ?? 0.10;
      return { name: b.name, exposure: b.size, contribution: b.size * sigma };
    });
    const total = rows.reduce((s, r) => s + r.contribution, 0) || 1;
    return rows
      .map((r) => ({ ...r, share: (r.contribution / total) * 100 }))
      .sort((a, b) => b.contribution - a.contribution);
  }, [treemapData]);

  // ── 24-cell heatmap renderer.
  const heatGrid = (
    <div className="grid grid-cols-12 gap-1.5">
      {Array.from({ length: 24 }).map((_, i) => {
        const cell = heatCells[i];
        if (!cell) {
          return <div key={i} className="aspect-square rounded-md border border-stone-200/60 dark:border-stone-800/60" />;
        }
        const tooltip = `${cell.ym} · ${fmtAudShort(cell.value)}${cell.deltaPct != null ? ` · ${cell.deltaPct >= 0 ? '+' : ''}${cell.deltaPct.toFixed(1)}% vs prior` : ''}`;
        return (
          <div
            key={i}
            title={tooltip}
            className="aspect-square rounded-md transition-all hover:ring-2 hover:ring-cyan-400 cursor-default"
            style={{ backgroundColor: heatColour(cell.deltaPct) }}
          />
        );
      })}
    </div>
  );

  // Treemap content renderer — neutral fill, cyan on hover (handled by stroke).
  const treemapContent = ({ x, y, width, height, name, size }: {
    x?: number; y?: number; width?: number; height?: number; name?: string; size?: number;
  }) => {
    const w = width ?? 0; const h = height ?? 0;
    if (w < 1 || h < 1) return <g />;
    const pct = totalValue > 0 ? ((size ?? 0) / totalValue) * 100 : 0;
    const showLabel = w > 70 && h > 36;
    return (
      <g>
        <rect
          x={x} y={y} width={w} height={h}
          style={{ fill: STONE_100, stroke: STONE_300, strokeWidth: 1 }}
          className="dark:[fill:#292524] dark:[stroke:#44403c] hover:[stroke:#00E5FF] transition-colors"
        />
        {showLabel && (
          <>
            <text x={(x ?? 0) + 8} y={(y ?? 0) + 18} fontSize={11} fontFamily="Geist Mono, ui-monospace, monospace"
              className="fill-stone-500 dark:fill-stone-400 uppercase tracking-wider">
              {name}
            </text>
            <text x={(x ?? 0) + 8} y={(y ?? 0) + 36} fontSize={14} fontFamily="Geist Mono, ui-monospace, monospace"
              className="fill-stone-900 dark:fill-stone-50">
              {fmtAudShort(size ?? 0)}
            </text>
            {h > 56 && (
              <text x={(x ?? 0) + 8} y={(y ?? 0) + 52} fontSize={10}
                className="fill-stone-500 dark:fill-stone-400">
                {pct.toFixed(1)}%
              </text>
            )}
          </>
        )}
      </g>
    );
  };

  const donutColours = [STONE_900, STONE_500, STONE_300, '#a8a29e'];
  const innerColours = [STONE_700, LIME];
  const yieldColours = ['#0e7490', '#155e75', '#0891b2', '#06b6d4', STONE_500, STONE_300, STONE_700];

  const surplus = income.net_surplus_per_month;
  const surplusColour = surplus >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';

  // Tooltip helpers — neutral card, mono numerals.
  const tooltipBox: React.CSSProperties = {
    backgroundColor: 'rgba(28, 25, 23, 0.95)',
    border: '1px solid #44403c',
    borderRadius: 8,
    padding: '8px 12px',
    color: '#f5f5f4',
    fontSize: 12,
    fontFamily: 'Geist Mono, ui-monospace, monospace',
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl text-stone-900 dark:text-stone-50 flex items-center gap-3">
            <Eye className="w-6 h-6 text-stone-500 dark:text-stone-400" strokeWidth={1.75} />
            Vision
          </h1>
          <p className="text-base text-stone-500 dark:text-stone-400">
            The 30-year picture — every chart on one page.
          </p>
        </div>
      </div>

      {/* Hero strip — three at-a-glance numbers */}
      <section>
        <SectionHeader icon={Wallet} label="At a glance" />
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
                Net worth today
              </p>
              <p className="text-3xl font-bold text-stone-900 dark:text-stone-50 tabular-nums mt-1">
                {fmtAudShort(totalValue)}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                across {treemapData.length} asset classes
              </p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
                Monthly income
              </p>
              <p className="text-3xl font-bold text-stone-900 dark:text-stone-50 tabular-nums mt-1">
                {fmtAudShort(income.total_monthly)}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                {income.total_monthly > 0
                  ? `${(((income.interest_monthly + income.staking_monthly) / income.total_monthly) * 100).toFixed(0)}% passive`
                  : 'no income'}
              </p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
                Net surplus
              </p>
              <p className={`text-3xl font-bold tabular-nums mt-1 ${surplusColour}`}>
                {surplus >= 0 ? '+' : ''}{fmtAudShort(surplus)}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                income − living burn
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 1. NW heatmap */}
      <section>
        <SectionHeader icon={CalendarDays} label="Net-worth pulse · last 24 months" />
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
          {heatCells.length === 0 ? (
            <p className="text-sm text-stone-500 dark:text-stone-400">No history yet — snapshots populate as the cron runs.</p>
          ) : (
            <>
              {heatGrid}
              <div className="mt-4 flex items-center justify-between text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
                <span>{heatCells[0]?.ym ?? ''}</span>
                <div className="flex items-center gap-1.5">
                  <span>−4%</span>
                  {['#7f1d1d', '#b91c1c', '#fda4af', STONE_300, '#86efac', '#22c55e', '#15803d'].map((c) => (
                    <span key={c} className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} />
                  ))}
                  <span>+4%</span>
                </div>
                <span>{heatCells[heatCells.length - 1]?.ym ?? ''}</span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* 2 + 3. Treemap + nested donut */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section>
          <SectionHeader icon={Layers} label="Asset-class composition" />
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
            <div className="h-72">
              {treemapData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-stone-500 dark:text-stone-400">
                  Loading…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <Treemap
                    data={treemapData}
                    dataKey="size"
                    aspectRatio={4 / 3}
                    content={treemapContent as never}
                    isAnimationActive={false}
                  >
                    <Tooltip
                      contentStyle={tooltipBox}
                      formatter={(v: number) => [fmtAud(v), '']}
                      labelStyle={{ color: '#f5f5f4' }}
                    />
                  </Treemap>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </section>

        <section>
          <SectionHeader icon={Banknote} label="Income sources" />
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
            <div className="h-72">
              {incomeOuter.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-stone-500 dark:text-stone-400">
                  Loading…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={incomeInner}
                      dataKey="value"
                      cx="50%" cy="50%"
                      innerRadius={0} outerRadius={50}
                      stroke="none"
                    >
                      {incomeInner.map((_, i) => (
                        <Cell key={i} fill={innerColours[i % innerColours.length]} />
                      ))}
                    </Pie>
                    <Pie
                      data={incomeOuter}
                      dataKey="value"
                      cx="50%" cy="50%"
                      innerRadius={62} outerRadius={100}
                      stroke="none"
                      label={({ name, percent }) => `${name} ${percent ? (percent * 100).toFixed(0) : 0}%`}
                    >
                      {incomeOuter.map((_, i) => (
                        <Cell key={i} fill={donutColours[i % donutColours.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipBox}
                      formatter={(v: number) => [fmtAud(v) + '/mo', '']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-2 text-center">
              Inner ring: earned vs passive. Outer: by source.
            </p>
          </div>
        </section>
      </div>

      {/* 4. Trajectory line */}
      <section>
        <SectionHeader icon={TrendingUp} label="Net-worth trajectory · 30-year compound" />
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
          <div className="h-80">
            {trajectoryData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-stone-500 dark:text-stone-400">
                Loading projection…
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trajectoryData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke={STONE_200} strokeDasharray="3 3" vertical={false} className="dark:[stroke:#292524]" />
                  <XAxis
                    dataKey="year"
                    tick={{ fontSize: 11, fontFamily: 'Geist Mono, ui-monospace, monospace', fill: STONE_500 }}
                    tickLine={false} axisLine={{ stroke: STONE_300 }}
                    label={{ value: 'years from now', position: 'insideBottom', offset: -4, fontSize: 10, fill: STONE_500 }}
                  />
                  <YAxis
                    tickFormatter={(v) => fmtAudShort(v)}
                    tick={{ fontSize: 11, fontFamily: 'Geist Mono, ui-monospace, monospace', fill: STONE_500 }}
                    tickLine={false} axisLine={{ stroke: STONE_300 }}
                    width={70}
                  />
                  <Tooltip
                    contentStyle={tooltipBox}
                    formatter={(v: number, name: string) => [fmtAud(v), name]}
                    labelFormatter={(l) => `Year ${l}`}
                  />
                  {/* Milestone reference lines — drawn behind so total dominates */}
                  {projection?.milestones.map((m) => (
                    m.amount > 0 ? (
                      <ReferenceLine
                        key={m.name}
                        y={m.amount}
                        stroke={STONE_300}
                        strokeDasharray="2 4"
                        label={{ value: m.name, position: 'right', fontSize: 10, fill: STONE_500 }}
                      />
                    ) : null
                  ))}
                  <Line type="monotone" dataKey="RealEstate" stroke={STONE_700} strokeWidth={1.5} dot={false} name="Real Estate" />
                  <Line type="monotone" dataKey="Cash"        stroke="#0891b2" strokeWidth={1.5} dot={false} name="Cash" />
                  <Line type="monotone" dataKey="Crypto"      stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Crypto" />
                  <Line type="monotone" dataKey="Equities"    stroke="#16a34a" strokeWidth={1.5} dot={false} name="Equities" />
                  <Line type="monotone" dataKey="total"       stroke={STONE_900} strokeWidth={2.5} dot className="dark:[stroke:#fafaf9]" name="Total" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-3">
            Defaults: real estate 5% · cash 4% · crypto 15% · equities 8% · vehicles −10% pa, nominal AUD.
          </p>
        </div>
      </section>

      {/* 5 + 6. Yield-per-account pie + risk-contribution bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section>
          <SectionHeader icon={Banknote} label="Yield by account · monthly $" />
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
            <div className="h-64">
              {yieldData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-stone-500 dark:text-stone-400">
                  No yielding accounts.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={yieldData}
                      dataKey="value"
                      cx="50%" cy="50%"
                      innerRadius={50} outerRadius={90}
                      stroke="none"
                      label={({ name, percent }) => percent && percent > 0.05 ? `${name} ${(percent * 100).toFixed(0)}%` : ''}
                    >
                      {yieldData.map((_, i) => (
                        <Cell key={i} fill={yieldColours[i % yieldColours.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipBox}
                      formatter={(v: number, _n, p: { payload?: { apy?: number; balance?: number } }) => [
                        `${fmtAud(v)}/mo · ${(p.payload?.apy ?? 0).toFixed(2)}% APY · ${fmtAudShort(p.payload?.balance ?? 0)}`,
                        '',
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-2 text-center tabular-nums">
              Total interest: <span className="text-stone-900 dark:text-stone-100 font-mono">{fmtAud(totalYieldMonthly)}/mo</span>
            </p>
          </div>
        </section>

        <section>
          <SectionHeader icon={AlertTriangle} label="Risk contribution by class" />
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
            <div className="h-64">
              {riskData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-stone-500 dark:text-stone-400">
                  Loading…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={riskData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke={STONE_200} strokeDasharray="3 3" horizontal={false} className="dark:[stroke:#292524]" />
                    <XAxis
                      type="number"
                      tickFormatter={(v) => `${v.toFixed(0)}%`}
                      tick={{ fontSize: 11, fontFamily: 'Geist Mono, ui-monospace, monospace', fill: STONE_500 }}
                      tickLine={false} axisLine={{ stroke: STONE_300 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 11, fontFamily: 'Geist Mono, ui-monospace, monospace', fill: STONE_500 }}
                      tickLine={false} axisLine={{ stroke: STONE_300 }}
                      width={88}
                    />
                    <Tooltip
                      contentStyle={tooltipBox}
                      formatter={(_v, _n, p: { payload?: { exposure?: number; share?: number } }) => [
                        `exposure ${fmtAudShort(p.payload?.exposure ?? 0)} · ${(p.payload?.share ?? 0).toFixed(0)}% of risk`,
                        '',
                      ]}
                    />
                    <Bar dataKey="share" radius={[0, 4, 4, 0]}>
                      {riskData.map((r) => (
                        <Cell key={r.name} fill={RISK_PALETTE[r.name] ?? STONE_500} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-2">
              σ-weighted: crypto carries the highest variance per dollar. Share = class σ × value ÷ total.
            </p>
          </div>
        </section>
      </div>

      {/* Caveat */}
      <p className="text-xs text-stone-500 dark:text-stone-400">
        <span className="font-mono uppercase tracking-wider">Note</span> ·
        Projections compound today's mix at default rates — they are not forecasts. Actual outcomes
        depend on the Acacia → Lind → 2030 plan landing.{income.opportunity_monthly_aud > 0 ? (
          <> Idle JPY moved to a 5.15%+ AUD account adds <span className="font-mono tabular-nums">{fmtAud(income.opportunity_monthly_aud)}/mo</span> right now.</>
        ) : null}
      </p>
    </div>
  );
};

export default Vision;
