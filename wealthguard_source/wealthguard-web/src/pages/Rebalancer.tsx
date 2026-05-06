import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Scale, RefreshCw, Loader2, Info, ChevronDown, ChevronRight, TrendingUp,
} from 'lucide-react';
import SectionHeader from '../components/SectionHeader';
import Skeleton from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import { useIncome } from '../hooks/useIncome';
import { usePersistentState } from '../hooks/usePersistentState';
import type { Holding, Account } from '../types/api';

type Bucket = 'realEstate' | 'cashYielding' | 'crypto' | 'stocks' | 'other';

interface Targets { real_estate_pct: number; cash_yielding_pct: number; crypto_pct: number; stocks_pct: number; other_pct: number }

const BUCKET_META: Record<Bucket, { label: string; target_key: keyof Targets; description: string }> = {
  realEstate:   { label: 'Real Estate',     target_key: 'real_estate_pct',   description: 'Acacia + Lind + any other property' },
  cashYielding: { label: 'Cash-yielding',   target_key: 'cash_yielding_pct', description: 'Savings + checking (Rabo, ANZ, Wise)' },
  crypto:       { label: 'Crypto',          target_key: 'crypto_pct',        description: 'BTC / ETH / SOL / XRP / SUI — long-term hold' },
  stocks:       { label: 'Stocks',          target_key: 'stocks_pct',        description: 'ASX + US equities' },
  other:        { label: 'Other',           target_key: 'other_pct',         description: 'Vehicles + anything unclassified' },
};

const fmtAud = (v: number) => v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const fmtAudShort = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${v < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 100_000) return `${v < 0 ? '-' : ''}$${Math.round(abs / 1000)}k`;
  if (abs >= 1_000) return `${v < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`;
  return fmtAud(v);
};

function bucketForHolding(h: Holding): Bucket {
  const cls = (h.asset_class || '').toLowerCase();
  if (cls === 'crypto') return 'crypto';
  if (cls === 'equity' || cls === 'etf' || cls === 'mutual_fund') return 'stocks';
  if (cls === 'alternative') {
    const sym = (h.symbol || '').toUpperCase();
    return sym.startsWith('VEHICLE') ? 'other' : 'realEstate';
  }
  return 'other';
}

const Rebalancer = () => {
  const income = useIncome();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = usePersistentState<boolean>('rebalancer-onboard-open', true);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [hRes, aRes, tRes] = await Promise.all([
        fetch('/api/holdings'),
        fetch('/api/accounts'),
        fetch('/api/rebalance/targets'),
      ]);
      if (!hRes.ok || !aRes.ok || !tRes.ok) throw new Error('load failed');
      setHoldings(await hRes.json());
      setAccounts(await aRes.json());
      setTargets(await tRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const buckets = useMemo(() => {
    const totals: Record<Bucket, number> = { realEstate: 0, cashYielding: 0, crypto: 0, stocks: 0, other: 0 };
    for (const h of holdings) totals[bucketForHolding(h)] += (h as any).value_aud || 0;
    for (const a of accounts) {
      if (a.type === 'savings' || a.type === 'checking') totals.cashYielding += (a as any).current_balance_aud || 0;
    }
    return totals;
  }, [holdings, accounts]);

  const totalNW = useMemo(() => Object.values(buckets).reduce((s, v) => s + v, 0), [buckets]);

  const currentPcts = useMemo<Record<Bucket, number>>(() => ({
    realEstate:   totalNW > 0 ? (buckets.realEstate   / totalNW) * 100 : 0,
    cashYielding: totalNW > 0 ? (buckets.cashYielding / totalNW) * 100 : 0,
    crypto:       totalNW > 0 ? (buckets.crypto       / totalNW) * 100 : 0,
    stocks:       totalNW > 0 ? (buckets.stocks       / totalNW) * 100 : 0,
    other:        totalNW > 0 ? (buckets.other        / totalNW) * 100 : 0,
  }), [buckets, totalNW]);

  const setTargetPct = (b: Bucket, v: number) => {
    if (!targets) return;
    const next = { ...targets };
    const key = BUCKET_META[b].target_key;
    next[key] = Math.max(0, Math.min(100, Math.round(v)));
    if (b !== 'other') {
      const otherTotal = 100 - (next.real_estate_pct + next.cash_yielding_pct + next.crypto_pct + next.stocks_pct);
      next.other_pct = Math.max(0, Math.round(otherTotal));
    }
    setTargets(next);
  };

  const saveTargets = async () => {
    if (!targets) return;
    setSaving(true);
    try {
      await fetch('/api/rebalance/targets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targets),
      });
    } finally { setSaving(false); }
  };

  const idleCash = useMemo(() => accounts
    .filter(a => (a.type === 'savings' || a.type === 'checking') && ((a as any).apy || 0) === 0 && ((a as any).current_balance_aud || 0) > 0)
    .map(a => ({ name: a.name, aud: (a as any).current_balance_aud || 0 })),
    [accounts]);

  if (loading) return <div className="p-6 space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (error)   return <div className="p-6"><ErrorState title="Couldn't load rebalancer" message={error} onRetry={load} /></div>;
  if (!targets) return null;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl text-stone-900 dark:text-stone-50 flex items-center gap-3">
            <Scale className="w-6 h-6 text-stone-500 dark:text-stone-400" strokeWidth={1.75} />
            Rebalancer
          </h1>
          <p className="text-base text-stone-500 dark:text-stone-400">
            Keep your drawdown mix close to target. Not a trading tool.
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

      <section>
        <button
          type="button"
          onClick={() => setOnboardingOpen(!onboardingOpen)}
          className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300"
        >
          {onboardingOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          How to use this page
        </button>
        {onboardingOpen && (
          <div className="mt-3 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 border-l-cyan-500 rounded-2xl p-5 space-y-3 text-base text-stone-700 dark:text-stone-300">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 mt-1 text-cyan-500 flex-shrink-0" />
              <p>
                A <strong className="text-stone-900 dark:text-stone-100">rebalance</strong> moves money between asset classes so you stay close to your target mix.
                You're in drawdown — the goal isn't aggressive growth, it's <strong className="text-stone-900 dark:text-stone-100">preserving the plan</strong>.
              </p>
            </div>
            <ul className="ml-6 space-y-1 text-base">
              <li><span className="inline-block w-2 h-2 rounded-full bg-stone-400 mr-2" /> neutral tile = at target (within 3pp)</li>
              <li><span className="inline-block w-2 h-2 rounded-full bg-yellow-500 mr-2" /> yellow = 3–8pp off target</li>
              <li><span className="inline-block w-2 h-2 rounded-full bg-rose-500 mr-2" /> rose = &gt;8pp off target (act soon)</li>
            </ul>
            <p>
              Drag the target sliders to match your intent. Defaults are <span className="font-mono">25/35/30/10/0</span> for a drawdown-mode Australian investor
              (real estate / cash-yielding / crypto / stocks / other). Save when done.
            </p>
          </div>
        )}
      </section>

      <section>
        <SectionHeader label={`Net worth ${fmtAud(totalNW)} · current allocation`} />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(Object.keys(BUCKET_META) as Bucket[]).map(b => {
            const m = BUCKET_META[b];
            const curPct = currentPcts[b];
            const tgtPct = targets[m.target_key] as number;
            const drift = curPct - tgtPct;
            const absDrift = Math.abs(drift);
            const colour = absDrift <= 3 ? 'bg-stone-400' : absDrift <= 8 ? 'bg-yellow-500' : 'bg-rose-500';
            return (
              <div key={b} className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${colour}`} />
                  <span className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">{m.label}</span>
                </div>
                <div className="text-2xl text-stone-900 dark:text-stone-50 tabular-nums">{fmtAudShort(buckets[b])}</div>
                <div className="text-xs text-stone-500 dark:text-stone-400 tabular-nums mt-1">
                  {curPct.toFixed(1)}% · target {tgtPct}% ·
                  <span className={`ml-1 ${drift >= 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {drift >= 0 ? '+' : ''}{drift.toFixed(1)}pp
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <SectionHeader
          label="Target mix"
          right={
            <button
              onClick={saveTargets}
              disabled={saving}
              className="text-xs text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save targets'}
            </button>
          }
        />
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 space-y-4">
          {(Object.keys(BUCKET_META) as Bucket[]).map(b => {
            const m = BUCKET_META[b];
            const v = targets[m.target_key] as number;
            return (
              <div key={b}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <div>
                    <span className="text-base text-stone-900 dark:text-stone-100">{m.label}</span>
                    <span className="ml-2 text-xs text-stone-500 dark:text-stone-400">{m.description}</span>
                  </div>
                  <span className="text-base font-mono tabular-nums text-stone-900 dark:text-stone-50">{v}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={v}
                  onChange={(e) => setTargetPct(b, Number(e.target.value))}
                  disabled={b === 'other'}
                  className="w-full accent-cyan-500"
                />
              </div>
            );
          })}
          <div className="pt-2 text-xs text-stone-500 dark:text-stone-400 tabular-nums">
            Sum (Other auto-adjusts):
            <span className="ml-2 font-mono">
              {targets.real_estate_pct + targets.cash_yielding_pct + targets.crypto_pct + targets.stocks_pct + targets.other_pct}%
            </span>
          </div>
        </div>
      </section>

      <section>
        <SectionHeader label="What to do" />
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
          <table className="min-w-full text-base">
            <thead>
              <tr className="border-b border-stone-200 dark:border-stone-800 text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
                <th className="text-left py-2">Bucket</th>
                <th className="text-right py-2">Current %</th>
                <th className="text-right py-2">Target %</th>
                <th className="text-right py-2">Drift</th>
                <th className="text-right py-2">Drift $AUD</th>
                <th className="text-left py-2 pl-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(BUCKET_META) as Bucket[]).map(b => {
                const m = BUCKET_META[b];
                const cur = currentPcts[b];
                const tgt = targets[m.target_key] as number;
                const drift = cur - tgt;
                const driftAud = (drift / 100) * totalNW;
                const absDrift = Math.abs(drift);
                const tone = absDrift <= 3 ? 'text-stone-500 dark:text-stone-400' : absDrift <= 8 ? 'text-yellow-700 dark:text-yellow-400' : 'text-rose-600 dark:text-rose-400';
                const action = absDrift <= 3
                  ? 'At target — no action'
                  : drift > 0
                    ? `Reduce ${m.label} by ${fmtAudShort(Math.abs(driftAud))}`
                    : `Top up ${m.label} by ${fmtAudShort(Math.abs(driftAud))}`;
                return (
                  <tr key={b} className="border-b border-stone-100 dark:border-stone-800/60">
                    <td className="py-2.5 text-stone-900 dark:text-stone-100">{m.label}</td>
                    <td className="py-2.5 text-right tabular-nums">{cur.toFixed(1)}%</td>
                    <td className="py-2.5 text-right tabular-nums text-stone-500 dark:text-stone-400">{tgt}%</td>
                    <td className={`py-2.5 text-right tabular-nums ${tone}`}>{drift >= 0 ? '+' : ''}{drift.toFixed(1)}pp</td>
                    <td className={`py-2.5 text-right tabular-nums ${tone}`}>{drift >= 0 ? '+' : ''}{fmtAudShort(driftAud)}</td>
                    <td className="py-2.5 pl-4 text-stone-700 dark:text-stone-300">{action}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {idleCash.length > 0 && income.opportunity_monthly_aud > 0 && (
        <section>
          <SectionHeader icon={TrendingUp} label="Income impact of rebalancing idle cash" />
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 border-l-emerald-500 rounded-2xl p-5">
            <div className="text-base text-stone-900 dark:text-stone-100">
              You have {idleCash.length === 1 ? 'an account' : `${idleCash.length} accounts`} at 0% APY totalling {fmtAud(idleCash.reduce((s, i) => s + i.aud, 0))}.
              Moving that balance to your best existing rate would add <span className="text-emerald-600 dark:text-emerald-400 font-mono">+{fmtAudShort(income.opportunity_monthly_aud)}/mo</span> in passive income.
            </div>
            <Link to="/advisor" className="inline-flex items-center gap-1 text-xs text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 mt-3">
              See in Advisor →
            </Link>
          </div>
        </section>
      )}

      {income.staking_monthly > 0 && (
        <section>
          <SectionHeader icon={TrendingUp} label="Crypto bucket is already earning" />
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 border-l-cyan-500 rounded-2xl p-5">
            <div className="text-base text-stone-900 dark:text-stone-100">
              The crypto bucket generates <span className="text-emerald-600 dark:text-emerald-400 font-mono">+{fmtAudShort(income.staking_monthly)}/mo</span> in staking rewards — that's income you keep even while holding through 2030.
            </div>
            {(income.staking_breakdown ?? []).length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-stone-600 dark:text-stone-400">
                {income.staking_breakdown.map(s => (
                  <li key={`${s.source}-${s.address}`} className="tabular-nums">
                    <span className="text-stone-900 dark:text-stone-100">{s.source}</span>
                    {' · '}{s.address.slice(0, 10)}…{s.address.slice(-4)}
                    {' · '}<span className="text-emerald-600 dark:text-emerald-400">${Math.round(s.monthly_aud).toLocaleString()}/mo</span>
                    <span className="text-xs text-stone-400 dark:text-stone-500"> ({s.basis})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
};

export default Rebalancer;
