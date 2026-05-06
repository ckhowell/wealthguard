import { useEffect, useState } from 'react';
import {
  Wallet, RefreshCw, Loader2, Sparkles, TrendingDown,
} from 'lucide-react';
import SectionHeader from '../components/SectionHeader';
import Skeleton from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import ToastContainer from '../components/ToastContainer';
import { useToast } from '../hooks/usePersistentState';
import { useIncome } from '../hooks/useIncome';

interface AiBudget {
  category: string;
  suggested_monthly_aud: number;
  current_monthly_avg_aud: number | null;
  reduction_potential_aud: number | null;
  rationale: string | null;
  generated_at?: string;
}

const fmtAud = (v: number) => v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const fmtAudShort = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${v < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 100_000) return `${v < 0 ? '-' : ''}$${Math.round(abs / 1000)}k`;
  if (abs >= 1_000) return `${v < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`;
  return fmtAud(v);
};

const Budgets = () => {
  const income = useIncome();
  const [budgets, setBudgets] = useState<AiBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toasts, addToast, removeToast } = useToast();

  const loadCached = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/budgets/ai-cached');
      if (!res.ok) throw new Error(`cached ${res.status}`);
      const list: AiBudget[] = await res.json();
      setBudgets(list);
      // Auto-generate if cache empty
      if (list.length === 0) await generate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally { setLoading(false); }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/budgets/ai-generate', { method: 'POST' });
      if (!res.ok) throw new Error(`generate ${res.status}`);
      const j = await res.json();
      setBudgets(j.budgets || []);
      addToast(`Generated ${(j.budgets || []).length} AI-proposed budgets`, 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Generate failed', 'error');
    } finally { setGenerating(false); }
  };

  useEffect(() => { loadCached(); }, []);

  if (loading && budgets.length === 0) return <div className="p-6 space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (error && budgets.length === 0) return <div className="p-6"><ErrorState title="Couldn't load budgets" message={error} onRetry={loadCached} /></div>;

  const totalSuggested = budgets.reduce((s, b) => s + (b.suggested_monthly_aud || 0), 0);
  const totalCurrent = budgets.reduce((s, b) => s + (b.current_monthly_avg_aud || 0), 0);
  const totalReduction = budgets.reduce((s, b) => s + (b.reduction_potential_aud || 0), 0);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl text-stone-900 dark:text-stone-50 flex items-center gap-3">
            <Wallet className="w-6 h-6 text-stone-500 dark:text-stone-400" strokeWidth={1.75} />
            Budgets
          </h1>
          <p className="text-base text-stone-500 dark:text-stone-400">
            AI-proposed realistic monthly targets based on your last 12 months of spending.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-600 text-stone-900 rounded-lg text-base inline-flex items-center gap-2 disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {budgets.length > 0 ? 'Regenerate' : 'Generate'}
        </button>
      </div>

      {/* Income anchor + reduction callout */}
      {!income.loading && income.total_monthly > 0 && (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 border-l-cyan-500 rounded-2xl p-5">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">Budgeting from</div>
            <div className="text-2xl text-stone-900 dark:text-stone-50 tabular-nums">${Math.round(income.total_monthly).toLocaleString()} <span className="text-base text-stone-500">/mo income</span></div>
            <div className="text-base text-stone-700 dark:text-stone-300 tabular-nums">
              AI-proposed total: ${Math.round(totalSuggested).toLocaleString()}/mo
              · income − budget =
              <span className={`ml-1 ${income.total_monthly - totalSuggested >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                ${Math.round(income.total_monthly - totalSuggested).toLocaleString()}/mo free
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Reduction potential summary */}
      {totalReduction > 0 && (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 border-l-emerald-500 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">Total reduction potential</span>
          </div>
          <div className="text-2xl text-emerald-600 dark:text-emerald-400 tabular-nums">+{fmtAudShort(totalReduction)}/mo saveable</div>
          <div className="text-base text-stone-700 dark:text-stone-300 mt-1">
            Currently averaging {fmtAudShort(totalCurrent)}/mo · suggested {fmtAudShort(totalSuggested)}/mo across {budgets.length} categories
          </div>
        </div>
      )}

      {/* Budget cards */}
      <section>
        <SectionHeader icon={Sparkles} label="AI-proposed budgets" />
        {budgets.length === 0 ? (
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 text-base text-stone-500 dark:text-stone-400">
            {generating ? 'Kimi is analysing your spending patterns…' : 'No budgets yet. Click Generate to have Kimi review your last 12 months and propose realistic monthly targets.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {budgets.map((b) => {
              const pctOfIncome = income.total_monthly > 0 ? (b.suggested_monthly_aud / income.total_monthly) * 100 : 0;
              const reductionPct = b.current_monthly_avg_aud && b.current_monthly_avg_aud > 0
                ? ((b.current_monthly_avg_aud - b.suggested_monthly_aud) / b.current_monthly_avg_aud) * 100
                : 0;
              return (
                <div key={b.category} className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5">
                  <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-1">
                    {b.category}
                  </div>
                  <div className="text-2xl text-stone-900 dark:text-stone-50 tabular-nums">{fmtAud(b.suggested_monthly_aud)}</div>
                  <div className="text-xs text-stone-500 dark:text-stone-400 tabular-nums mt-1">
                    {pctOfIncome.toFixed(0)}% of income · was {b.current_monthly_avg_aud != null ? fmtAudShort(b.current_monthly_avg_aud) : '—'}/mo
                  </div>

                  {b.reduction_potential_aud != null && b.reduction_potential_aud > 0 && (
                    <div className="mt-3 flex items-center gap-2">
                      <TrendingDown className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <span className="text-xs font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                        −{fmtAudShort(b.reduction_potential_aud)}/mo ({reductionPct.toFixed(0)}% cut)
                      </span>
                    </div>
                  )}

                  {b.rationale && (
                    <p className="mt-3 text-base text-stone-700 dark:text-stone-300 leading-snug">
                      {b.rationale}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

// Named alias — used by the consolidated `/spending` page tab nav.
export const BudgetsView = Budgets;

export default Budgets;
