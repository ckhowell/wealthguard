import { useEffect, useMemo, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend,
} from 'recharts';
import {
  Map, Save, AlertTriangle, CheckCircle2, Home, Hammer, PalmtreeIcon,
  Calendar, TrendingDown, Sparkles, RefreshCw, Loader2, ShieldAlert,
  ChevronRight, ListChecks,
} from 'lucide-react';
import Skeleton from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import ToastContainer from '../components/ToastContainer';
import TabBar from '../components/TabBar';
import { ProjectsView } from './Projects';
import { fmtAge } from '../lib/aiCache';
import { useToast } from '../hooks/usePersistentState';
import { useIncome } from '../hooks/useIncome';

// Lucide doesn't export Palmtree in all versions; use a safe fallback.
const Palm = PalmtreeIcon || Home;

interface Plan {
  acacia_current_value: number | null;
  acacia_reno_remaining: number | null;
  acacia_target_sale_price: number | null;
  acacia_target_sale_month: string | null;
  acacia_is_ppor: number | null;
  lind_current_value: number | null;
  lind_mortgage_balance: number | null;
  lind_build_cost: number | null;
  lind_build_start_month: string | null;
  lind_build_end_month: string | null;
  lind_target_sale_price: number | null;
  lind_target_sale_month: string | null;
  lind_is_ppor: number | null;
  retirement_start_month: string | null;
  retirement_property: string | null;
  retirement_prep_cost: number | null;
  retirement_monthly_spend: number | null;
  retirement_income_monthly: number | null;
  notes: string | null;
}

interface SimRow {
  month: string; burn: number; reno_spend: number; build_spend: number;
  sale_in: number; net_month: number; cash: number; status: string;
}
interface SimResp {
  starting_cash: number; baseline_burn: number; retire_month: string; end_month: string;
  series: SimRow[]; warnings: { month: string; cash: number; status: string }[];
  min_cash: number; min_cash_month: string | null; ending_cash: number;
}

const emptyPlan = (): Plan => ({
  acacia_current_value: null, acacia_reno_remaining: null, acacia_target_sale_price: null,
  acacia_target_sale_month: null, acacia_is_ppor: 0,
  lind_current_value: null, lind_mortgage_balance: null, lind_build_cost: null,
  lind_build_start_month: null, lind_build_end_month: null, lind_target_sale_price: null,
  lind_target_sale_month: null, lind_is_ppor: 1,
  retirement_start_month: null, retirement_property: null, retirement_prep_cost: null,
  retirement_monthly_spend: null, retirement_income_monthly: null, notes: null,
});

const fmtAud = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

const fmtMonth = (ym: string | null) => {
  if (!ym) return '—';
  const [y, m] = ym.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
};

// PlanContent — the original Plan page body (StressCard, CompletenessBar,
// simulator chart, sliders). Renamed from PlanPage so the new outer wrapper
// can mount it conditionally based on the active sub-tab.
const PlanContent = () => {
  const income = useIncome();
  const [plan, setPlan] = useState<Plan>(emptyPlan());
  const [sim, setSim] = useState<SimResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toasts, addToast, removeToast } = useToast();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/plan');
      if (res.ok) {
        const data = await res.json();
        setPlan({ ...emptyPlan(), ...data });
      }
      await runSim();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  const runSim = async () => {
    try {
      const res = await fetch('/api/plan/simulate');
      if (res.ok) {
        const data = await res.json();
        if (!data.error) setSim(data);
      }
    } catch {}
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      // Only send non-null fields (backend treats null as "don't change")
      const body: Record<string, any> = {};
      Object.entries(plan).forEach(([k, v]) => {
        if (v !== null && v !== '') body[k] = v;
      });
      const res = await fetch('/api/plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.detail || `Save failed (${res.status})`);
      }
      addToast('Plan saved', 'success');
      await runSim();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof Plan, v: any) => setPlan(prev => ({ ...prev, [k]: v }));

  const chartData = useMemo(() => {
    if (!sim) return [];
    return sim.series.map(s => ({
      ...s,
      label: fmtMonth(s.month),
      gross_out: s.burn + s.reno_spend + s.build_spend,
    }));
  }, [sim]);

  if (loading) return <div className="p-6"><Skeleton /></div>;
  if (error) return <div className="p-6"><ErrorState message={error} /></div>;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl text-stone-900 dark:text-stone-50 flex items-center gap-3">
            <Map className="w-6 h-6 text-cyan-500" /> Retirement Plan
          </h1>
          <p className="text-base text-stone-500 dark:text-stone-400">Acacia reno → sell → fund Lind build → sell 2030 → retire to Tasmania.</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg text-base inline-flex items-center gap-2 disabled:opacity-50"
        >
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save & re-simulate'}
        </button>
      </div>

      {/* ===== Plan Completeness Gate ===== */}
      <PlanCompletenessBar />

      {/* ===== AI Plan Stress-tester ===== */}
      <PlanStressCard />

      {/* ===== Simulation summary ===== */}
      {sim && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <SimCard label="Starting cash (today)" value={fmtAud(sim.starting_cash)} />
          <SimCard
            label={`Lowest cash (${fmtMonth(sim.min_cash_month)})`}
            value={fmtAud(sim.min_cash)}
            accent={sim.min_cash < 0 ? 'text-rose-600' : sim.min_cash < 50000 ? 'text-cyan-500' : 'text-emerald-600'}
          />
          <SimCard
            label={`Ending cash (${fmtMonth(sim.end_month)})`}
            value={fmtAud(sim.ending_cash)}
            accent={sim.ending_cash < 0 ? 'text-rose-600' : 'text-emerald-600'}
          />
          {/* `baseline_burn` from the API is gross living-spend pre-income.
              Showing it as a negative "burn" was misleading next to the
              income-strip below that shows the actual net surplus.  Re-label
              + re-sign to match: this is monthly OUT, not net BURN. */}
          <SimCard label="Living spend /mo" value={fmtAud(sim.baseline_burn)} accent="text-stone-700 dark:text-stone-300" />
        </div>
      )}

      {/* ===== Warnings ===== */}
      {sim && sim.warnings.length > 0 && (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 border-l-rose-500 rounded-2xl p-4">
          <div className="flex items-center gap-2 text-stone-900 dark:text-stone-100 mb-2">
            <AlertTriangle className="w-4 h-4 text-rose-500" /> {sim.warnings.length} month(s) at risk
          </div>
          <ul className="text-base text-stone-700 dark:text-stone-300 space-y-1">
            {sim.warnings.slice(0, 5).map(w => (
              <li key={w.month}>
                {fmtMonth(w.month)}: cash {fmtAud(w.cash)} ({w.status})
              </li>
            ))}
            {sim.warnings.length > 5 && <li>+ {sim.warnings.length - 5} more</li>}
          </ul>
        </div>
      )}

      {/* ===== Income assumption strip — what's baked into this simulation ===== */}
      {!income.loading && income.total_monthly > 0 && (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 border-l-cyan-500 rounded-2xl p-5">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Income baked into this simulation
            </div>
            <div className="text-2xl text-stone-900 dark:text-stone-50 tabular-nums">
              ${Math.round(income.total_monthly).toLocaleString()}/mo
            </div>
            <div className="text-base text-stone-700 dark:text-stone-300 tabular-nums">
              Nicole ${Math.round(income.nicole_monthly).toLocaleString()} · interest ${Math.round(income.interest_monthly).toLocaleString()}
              {income.staking_monthly > 0 && (
                <> · staking ${Math.round(income.staking_monthly).toLocaleString()}</>
              )}
              {' · net monthly surplus'}
              <span className={`ml-1 ${income.net_surplus_per_month >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {income.net_surplus_per_month >= 0 ? '+' : ''}${Math.round(income.net_surplus_per_month).toLocaleString()}
              </span>
            </div>
          </div>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            Plan burn = living spend − this income. If Nicole's income changes or APY drops, re-save `wealth_plan.nicole_income_monthly` or the account's APY to resim.
          </p>
        </div>
      )}

      {/* ===== Chart ===== */}
      {sim && chartData.length > 0 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6">
          <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">Cash trajectory</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="cashGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-stone-200 dark:text-stone-800" />
              <XAxis dataKey="label" stroke="currentColor" className="text-stone-500 dark:text-stone-400" fontSize={11} />
              <YAxis stroke="currentColor" className="text-stone-500 dark:text-stone-400" fontSize={11} tickFormatter={(v) => `$${Math.round(v/1000)}k`} />
              <Tooltip formatter={(v: number) => fmtAud(v)} />
              <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="4 4" />
              <ReferenceLine y={50000} stroke="#00E5FF" strokeDasharray="4 4" label={{ value: '$50k floor', fontSize: 10, fill: '#00E5FF' }} />
              <Area type="monotone" dataKey="cash" stroke="#10b981" fill="url(#cashGradient)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-2">Red dashed = $0. Amber dashed = $50k buffer. Anything below amber is tight; below red is broken.</p>
        </div>
      )}

      {/* ===== Monthly flows chart ===== */}
      {sim && chartData.length > 0 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6">
          <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">Monthly cashflows</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-stone-200 dark:text-stone-800" vertical={false} />
              <XAxis dataKey="label" stroke="currentColor" className="text-stone-500 dark:text-stone-400" fontSize={10} />
              <YAxis stroke="currentColor" className="text-stone-500 dark:text-stone-400" fontSize={10} tickFormatter={(v) => `$${Math.round(v/1000)}k`} />
              <Tooltip formatter={(v: number) => fmtAud(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="burn" name="Living burn" stackId="out" fill="#f43f5e" />
              <Bar dataKey="reno_spend" name="Acacia reno" stackId="out" fill="#00E5FF" />
              <Bar dataKey="build_spend" name="Lind build" stackId="out" fill="#7c3aed" />
              <Bar dataKey="sale_in" name="Sale proceeds" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ===== Input forms ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Acacia */}
        <Section icon={<Hammer className="w-4 h-4 text-cyan-500" />} title="18 Acacia Drive (Ansons Bay TAS)" subtitle="Reno → sell → fund Lind build">
          <MoneyField label="Current as-is value" value={plan.acacia_current_value} onChange={v => set('acacia_current_value', v)} />
          <MoneyField label="Reno budget still to spend" value={plan.acacia_reno_remaining} onChange={v => set('acacia_reno_remaining', v)} />
          <MoneyField label="Target sale price" value={plan.acacia_target_sale_price} onChange={v => set('acacia_target_sale_price', v)} />
          <MonthField label="Target sale month" value={plan.acacia_target_sale_month} onChange={v => set('acacia_target_sale_month', v)} fieldName="acacia_target_sale_month" />
          <BoolField label="Is PPoR?" value={plan.acacia_is_ppor} onChange={v => set('acacia_is_ppor', v)} hint="If no, CGT applies (50% discount if >12mo held)" />
        </Section>

        {/* Lind */}
        <Section icon={<Home className="w-4 h-4 text-violet-600" />} title="27 Lind Ave (Southport QLD)" subtitle="Build now → sell 2030 → retire">
          <MoneyField label="Current value" value={plan.lind_current_value} onChange={v => set('lind_current_value', v)} />
          <MoneyField label="Mortgage balance (if any)" value={plan.lind_mortgage_balance} onChange={v => set('lind_mortgage_balance', v)} />
          <MoneyField label="Build cost estimate" value={plan.lind_build_cost} onChange={v => set('lind_build_cost', v)} />
          <MonthField label="Build start month" value={plan.lind_build_start_month} onChange={v => set('lind_build_start_month', v)} fieldName="lind_build_start_month" />
          <MonthField label="Build completion month" value={plan.lind_build_end_month} onChange={v => set('lind_build_end_month', v)} fieldName="lind_build_end_month" />
          <MoneyField label="Target 2030 sale price" value={plan.lind_target_sale_price} onChange={v => set('lind_target_sale_price', v)} />
          <MonthField label="Target sale month" value={plan.lind_target_sale_month} onChange={v => set('lind_target_sale_month', v)} placeholder="2030-12" />
          <BoolField label="Is PPoR throughout?" value={plan.lind_is_ppor} onChange={v => set('lind_is_ppor', v)} hint="If yes, sale is 100% CGT-free" />
        </Section>

        {/* Retirement */}
        <Section icon={<Palm className="w-4 h-4 text-emerald-600" />} title="Retirement (Tasmania)" subtitle="After Lind sells">
          <MonthField label="Retirement start month" value={plan.retirement_start_month} onChange={v => set('retirement_start_month', v)} placeholder="2030-12" fieldName="retirement_start_month" />
          <TextField
            label="Retirement property"
            value={plan.retirement_property || ''}
            onChange={v => set('retirement_property', v || null)}
            placeholder="Ansons Bay 143-145"
          />
          <MoneyField label="Prep / move-in cost" value={plan.retirement_prep_cost} onChange={v => set('retirement_prep_cost', v)} fieldName="retirement_prep_cost" />
          <MoneyField label="Expected monthly spend" value={plan.retirement_monthly_spend} onChange={v => set('retirement_monthly_spend', v)} hint="Same as today, or different?" fieldName="retirement_monthly_spend" />
          <MoneyField label="Expected monthly income" value={plan.retirement_income_monthly} onChange={v => set('retirement_income_monthly', v)} hint="Super drawdown + rent + dividends" fieldName="retirement_income_monthly" />
        </Section>
      </div>

      {/* Notes */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6">
        <label className="block text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-2">Notes</label>
        <textarea
          value={plan.notes || ''}
          onChange={e => set('notes', e.target.value || null)}
          rows={3}
          placeholder="Assumptions, risks, dependencies…"
          className="w-full px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base"
        />
      </div>
    </div>
  );
};

// ---------- subcomponents ----------

const Section = ({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) => (
  <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-5 space-y-2.5">
    <div>
      <div className="flex items-center gap-2">{icon}<h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">{title}</h3></div>
      <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{subtitle}</p>
    </div>
    {children}
  </div>
);

const MoneyField = ({ label, value, onChange, hint, fieldName }: { label: string; value: number | null; onChange: (v: number | null) => void; hint?: string; fieldName?: string }) => (
  <div id={fieldName ? `field-${fieldName}` : undefined}>
    <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">{label}</label>
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base text-stone-400">$</span>
      <input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value ? parseFloat(e.target.value) : null)}
        placeholder="0"
        className="w-full pl-7 pr-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
      />
    </div>
    {hint && <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">{hint}</p>}
  </div>
);

const MonthField = ({ label, value, onChange, placeholder, fieldName }: { label: string; value: string | null; onChange: (v: string | null) => void; placeholder?: string; fieldName?: string }) => (
  <div id={fieldName ? `field-${fieldName}` : undefined}>
    <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">{label}</label>
    <input
      type="month"
      value={value || ''}
      onChange={e => onChange(e.target.value || null)}
      placeholder={placeholder}
      className="w-full px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
    />
  </div>
);

const BoolField = ({ label, value, onChange, hint }: { label: string; value: number | null; onChange: (v: number) => void; hint?: string }) => (
  <div>
    <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">{label}</label>
    <div className="flex gap-2">
      <button onClick={() => onChange(1)} className={`flex-1 py-1.5 rounded-lg text-base border ${value === 1 ? 'bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200' : 'bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700'}`}>Yes</button>
      <button onClick={() => onChange(0)} className={`flex-1 py-1.5 rounded-lg text-base border ${value === 0 ? 'bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200' : 'bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700'}`}>No</button>
    </div>
    {hint && <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">{hint}</p>}
  </div>
);

const TextField = ({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) => (
  <div>
    <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">{label}</label>
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base"
    />
  </div>
);

const SimCard = ({ label, value, accent }: { label: string; value: string; accent?: string }) => (
  <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-4">
    <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</div>
    <div className={`text-2xl font-semibold mt-1 ${accent || 'text-stone-800 dark:text-stone-100'}`}>{value}</div>
  </div>
);

// ============================================================================
// AI Plan Stress-tester card
//
// Pulls /api/intel/plan-stress — 6 scenarios (baseline + 4 stress + bull)
// with min_cash, ending_cash, warnings, health — + Kimi narrative of the
// single highest-leverage pre-emptive action.  Slotted at the top of Plan
// page so the user sees tail-risk framing before the happy-path sim summary.
// ============================================================================
interface StressScenario {
  key: string;
  label: string;
  desc: string;
  min_cash: number | null;
  min_cash_month: string | null;
  ending_cash: number | null;
  warnings_count: number;
  break_count: number;
  first_break_month: string | null;
  health: 'green' | 'amber' | 'red' | null;
}
interface PlanStressResp {
  as_of: string;
  scenarios: StressScenario[];
  baseline_ending_cash: number | null;
  bear_ending_cash: number | null;
  worst_min_cash: number | null;
  worst_scenario_key: string | null;
  break_scenario_count: number;
  total_scenario_count: number;
  narrative: string;
  narrative_provider: string;
  error?: string;
  // Iteration 22 cache-meta. See src/lib/aiCache.ts for the pattern.
  cached?: false;
  _cached_at?: string | null;
  _age_seconds?: number;
  _stale?: boolean;
}

const healthToneCls = (h: StressScenario['health']) =>
  h === 'green' ? 'text-emerald-600 dark:text-emerald-400' :
  h === 'amber' ? 'text-yellow-600 dark:text-yellow-400' :
  h === 'red'   ? 'text-rose-600 dark:text-rose-400' :
  'text-stone-500 dark:text-stone-400';

const PlanStressCard = () => {
  const [data, setData] = useState<PlanStressResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Iteration 22: mount uses `cache_only=true` so we render last cached
  // scenarios instantly and never fire 6 plan-sims + Kimi on page-visit.
  const load = async (mode: 'mount' | 'fresh' = 'mount') => {
    setLoading(true); setErr(null);
    try {
      const qs = mode === 'fresh' ? '?force=true' : '?cache_only=true';
      const res = await fetch(`/api/intel/plan-stress${qs}`);
      if (!res.ok) throw new Error(`plan-stress ${res.status}`);
      const j: PlanStressResp = await res.json();
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
          <ShieldAlert className="w-3.5 h-3.5 text-cyan-500" /> AI Plan Stress-tester
          {data && !noCache && data.narrative_provider && (
            <span className="text-stone-400 dark:text-stone-500">· via {data.narrative_provider}</span>
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
          {loading ? 'Running 6 scenarios…' : (noCache ? 'Run analysis' : 'Re-run')}
        </button>
      </div>

      {err ? (
        <ErrorState title="Stress-tester unavailable" message={err} onRetry={() => load('fresh')} />
      ) : noCache ? (
        <p className="text-base text-stone-500 dark:text-stone-400">
          No stress-test on file — click <span className="text-cyan-600 dark:text-cyan-400">Run analysis</span> to simulate 6 scenarios (baseline + 4 stress + bull) and surface tail-risk recommendations. (One Kimi call.)
        </p>
      ) : !data ? (
        <Skeleton className="h-56 w-full" />
      ) : (
        <>
          {/* Summary strip */}
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-4 text-base text-stone-900 dark:text-stone-100">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 block">Scenarios breaking zero</span>
              <span className="text-2xl tabular-nums font-mono">
                <span className={data.break_scenario_count > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                  {data.break_scenario_count}
                </span>
                <span className="text-stone-400 dark:text-stone-500"> / {data.total_scenario_count}</span>
              </span>
            </div>
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 block">Worst min-cash</span>
              <span className="text-2xl tabular-nums font-mono text-rose-600 dark:text-rose-400">
                {fmtAud(data.worst_min_cash ?? 0)}
              </span>
            </div>
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 block">Bear ending cash</span>
              <span className="text-2xl tabular-nums font-mono text-stone-900 dark:text-stone-100">
                {fmtAud(data.bear_ending_cash ?? 0)}
              </span>
            </div>
          </div>

          {/* Scenarios table */}
          <div className="overflow-x-auto mb-4">
            <table className="min-w-full text-base">
              <thead>
                <tr className="border-b border-stone-200 dark:border-stone-800 text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  <th className="text-left py-2">Scenario</th>
                  <th className="text-right py-2">Min cash</th>
                  <th className="text-left py-2 pl-3">When</th>
                  <th className="text-right py-2">Ending cash</th>
                  <th className="text-right py-2">Warnings</th>
                  <th className="text-left py-2 pl-3">Health</th>
                </tr>
              </thead>
              <tbody>
                {data.scenarios.map((s) => (
                  <tr key={s.key} className="border-b border-stone-100 dark:border-stone-800/60">
                    <td className="py-2.5">
                      <div className="text-stone-900 dark:text-stone-100">{s.label}</div>
                      <div className="text-xs text-stone-500 dark:text-stone-400">{s.desc}</div>
                    </td>
                    <td className={`py-2.5 text-right tabular-nums font-mono ${(s.min_cash ?? 0) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-stone-900 dark:text-stone-100'}`}>
                      {fmtAud(s.min_cash ?? 0)}
                    </td>
                    <td className="py-2.5 pl-3 text-stone-500 dark:text-stone-400 font-mono text-sm">
                      {s.min_cash_month ? fmtMonth(s.min_cash_month) : '—'}
                    </td>
                    <td className="py-2.5 text-right tabular-nums font-mono">{fmtAud(s.ending_cash ?? 0)}</td>
                    <td className="py-2.5 text-right tabular-nums font-mono text-stone-500 dark:text-stone-400">
                      {s.warnings_count}{s.break_count > 0 ? ` / ${s.break_count}b` : ''}
                    </td>
                    <td className={`py-2.5 pl-3 text-sm font-mono uppercase ${healthToneCls(s.health)}`}>
                      {s.health ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Kimi narrative */}
          <p className="text-base text-stone-900 dark:text-stone-100 leading-relaxed">
            {data.narrative}
          </p>

          <div className="mt-3 text-xs font-mono uppercase tracking-wider text-stone-400 dark:text-stone-500">
            scanned {new Date(data.as_of).toLocaleString('en-AU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · 6 Monte-Carlo-style paths
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================================
// PlanCompletenessBar — the plan's "am I filled in?" surface.
//
// Pulls /api/plan/completeness. Self-hides nothing — even when green, shows a
// single "plan complete" chip so the user knows the check ran. Each gap is a
// clickable button that scrolls to + focuses the relevant input (MonthField /
// MoneyField expose their field names via `id="field-<fieldName>"`).
// ============================================================================
interface PlanGap {
  field: string;
  label: string;
  severity: 'high' | 'medium' | 'low';
  impact: string;
  current_value: string | number | null;
}
interface PlanCompletenessResp {
  status: 'green' | 'amber' | 'red';
  complete: boolean;
  gaps: PlanGap[];
  filled: PlanGap[];
  counts: {
    high_open: number;
    medium_open: number;
    low_open: number;
    total_open: number;
    total_checked: number;
  };
  as_of: string;
}

const sevChipCls = (s: PlanGap['severity']) =>
  s === 'high'   ? 'text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-900/50' :
  s === 'medium' ? 'text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700/60' :
                   'text-stone-500 dark:text-stone-400 border-stone-300 dark:border-stone-700';

const scrollToField = (fieldName: string) => {
  const el = document.getElementById(`field-${fieldName}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Focus the input inside after the scroll frame
  setTimeout(() => {
    const input = el.querySelector('input') as HTMLInputElement | null;
    input?.focus();
    // Briefly highlight the container to draw the eye
    el.classList.add('ring-2', 'ring-cyan-500/60');
    setTimeout(() => el.classList.remove('ring-2', 'ring-cyan-500/60'), 1200);
  }, 350);
};

const PlanCompletenessBar = () => {
  const [data, setData] = useState<PlanCompletenessResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch('/api/plan/completeness');
      if (!res.ok) throw new Error(`completeness ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (err) return <ErrorState title="Plan completeness check unavailable" message={err} onRetry={load} />;
  if (!data) {
    if (loading) return <Skeleton className="h-20 w-full" />;
    return null;
  }

  const borderTone =
    data.status === 'red'    ? 'border-l-rose-500'  :
    data.status === 'amber'  ? 'border-l-yellow-500' :
                               'border-l-emerald-500';

  if (data.complete) {
    return (
      <div className={`bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 ${borderTone} rounded-2xl p-3 inline-flex items-center gap-2`}>
        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
        <span className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">Plan complete</span>
        <span className="text-sm text-stone-600 dark:text-stone-300 ml-2">
          {data.counts.total_checked} / {data.counts.total_checked} fields filled
        </span>
      </div>
    );
  }

  return (
    <div className={`bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 ${borderTone} rounded-2xl p-5`}>
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">
          <ListChecks className="w-3.5 h-3.5 text-cyan-500" /> Plan completeness
          <span className="text-stone-400 dark:text-stone-500">
            · {data.counts.total_open} / {data.counts.total_checked} open
            {data.counts.high_open > 0 && (
              <> · <span className="text-rose-600 dark:text-rose-400">{data.counts.high_open} breaking the sim</span></>
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          aria-label="Refresh completeness"
          className="text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 inline-flex items-center gap-1 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      <ul className="space-y-2">
        {data.gaps.map((g) => (
          <li
            key={g.field}
            className={`border border-stone-200 dark:border-stone-800 rounded-lg p-3 flex items-start justify-between gap-3`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${sevChipCls(g.severity)}`}>
                  {g.severity}
                </span>
                <span className="text-base text-stone-900 dark:text-stone-100">{g.label}</span>
              </div>
              <p className="text-sm text-stone-700 dark:text-stone-300 mt-1 leading-snug">
                {g.impact}
              </p>
            </div>
            <button
              type="button"
              onClick={() => scrollToField(g.field)}
              aria-label={`Fill in ${g.label}`}
              className="text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded whitespace-nowrap"
            >
              Fill it <ChevronRight className="w-3 h-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ============================================================================
// PlanPage — outer host that owns the sub-tab state for the consolidated
// Plan + Projects view. Reads `?tab=projects` from the URL on mount so
// deep-links and the legacy `/projects` redirect both land on the right tab.
// Tab choice is synced back to the URL via history.replaceState (no navigate
// — we don't want to push a new history entry per tab switch).
// ============================================================================
type PlanTab = 'plan' | 'projects';

const PlanPage = () => {
  const [tab, setTab] = useState<PlanTab>(() => {
    if (typeof window === 'undefined') return 'plan';
    return new URLSearchParams(window.location.search).get('tab') === 'projects'
      ? 'projects'
      : 'plan';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (tab === 'projects') url.searchParams.set('tab', 'projects');
    else url.searchParams.delete('tab');
    window.history.replaceState({}, '', url.toString());
  }, [tab]);

  return (
    <div>
      <div className="px-6 pt-6 max-w-[1400px] mx-auto">
        <TabBar<PlanTab>
          ariaLabel="Plan and Projects"
          tabs={[
            { id: 'plan',     label: 'Plan',     hint: 'Retirement plan: simulator, stress-tester, completeness gate' },
            { id: 'projects', label: 'Projects', hint: 'Acacia reno + Lind build: spend-to-date, forecaster' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>
      {tab === 'plan' ? <PlanContent /> : <ProjectsView />}
    </div>
  );
};

export default PlanPage;
