import { useEffect, useState } from 'react';
import {
  Target, Plus, Pencil, Trash2, X, Loader2, Sparkles, CheckCircle2, RefreshCw,
} from 'lucide-react';
import SectionHeader from '../components/SectionHeader';
import Skeleton from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import ToastContainer from '../components/ToastContainer';
import { useToast } from '../hooks/usePersistentState';
import { useIncome } from '../hooks/useIncome';

interface Goal {
  id: number;
  name: string;
  kind: 'user' | 'ai';
  target_amount: number | null;
  current_amount: number | null;
  target_date: string | null;
  monthly_contribution: number | null;
  rationale: string | null;
  status: 'active' | 'paused' | 'done';
  notes: string | null;
}

interface AiGoal {
  name: string;
  target_amount_aud: number | null;
  target_date: string | null;
  monthly_contribution_aud: number | null;
  rationale: string;
}

interface GoalForm {
  id: number | null;
  name: string;
  target_amount: string;
  current_amount: string;
  target_date: string;
  monthly_contribution: string;
  notes: string;
}

const EMPTY_FORM: GoalForm = { id: null, name: '', target_amount: '', current_amount: '', target_date: '', monthly_contribution: '', notes: '' };

const fmtAud = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const fmtAudShort = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${v < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 100_000) return `${v < 0 ? '-' : ''}$${Math.round(abs / 1000)}k`;
  if (abs >= 1_000) return `${v < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`;
  return fmtAud(v);
};
const weeksOfIncome = (amount: number, incomeMonthly: number) => incomeMonthly > 0 ? (amount / (incomeMonthly / 4.33)).toFixed(1) : '—';

const Goals = () => {
  const income = useIncome();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [aiGoals, setAiGoals] = useState<AiGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<GoalForm | null>(null);
  const [saving, setSaving] = useState(false);
  const { toasts, addToast, removeToast } = useToast();

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/goals');
      if (!res.ok) throw new Error(`load ${res.status}`);
      setGoals(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally { setLoading(false); }
  };

  const loadAiGoals = async () => {
    setAiLoading(true);
    try {
      const res = await fetch('/api/goals/ai-suggest', { method: 'POST' });
      if (!res.ok) throw new Error(`AI ${res.status}`);
      const j = await res.json();
      setAiGoals(j.goals || []);
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'AI suggest failed', 'error');
    } finally { setAiLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const acceptAi = async (g: AiGoal) => {
    try {
      const res = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: g.name, kind: 'ai',
          target_amount: g.target_amount_aud,
          target_date: g.target_date,
          monthly_contribution: g.monthly_contribution_aud,
          rationale: g.rationale,
          status: 'active',
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setAiGoals(prev => prev.filter(x => x.name !== g.name));
      addToast(`Added "${g.name}"`, 'success');
      await load();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Accept failed', 'error');
    }
  };

  const dismissAi = (name: string) => setAiGoals(prev => prev.filter(x => x.name !== name));

  const openCreate = () => setForm({ ...EMPTY_FORM });
  const openEdit = (g: Goal) => setForm({
    id: g.id,
    name: g.name,
    target_amount: g.target_amount != null ? String(g.target_amount) : '',
    current_amount: g.current_amount != null ? String(g.current_amount) : '',
    target_date: g.target_date || '',
    monthly_contribution: g.monthly_contribution != null ? String(g.monthly_contribution) : '',
    notes: g.notes || '',
  });

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) { addToast('Name required', 'warning'); return; }
    setSaving(true);
    try {
      const body = JSON.stringify({
        name: form.name.trim(),
        kind: 'user',
        target_amount: form.target_amount ? parseFloat(form.target_amount) : null,
        current_amount: form.current_amount ? parseFloat(form.current_amount) : null,
        target_date: form.target_date || null,
        monthly_contribution: form.monthly_contribution ? parseFloat(form.monthly_contribution) : null,
        notes: form.notes || null,
        status: 'active',
      });
      const url = form.id ? `/api/goals/${form.id}` : '/api/goals';
      const method = form.id ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body });
      if (!res.ok) throw new Error(`save ${res.status}`);
      addToast(form.id ? 'Goal updated' : 'Goal created', 'success');
      setForm(null);
      await load();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally { setSaving(false); }
  };

  const remove = async (g: Goal) => {
    if (!confirm(`Delete "${g.name}"?`)) return;
    try {
      await fetch(`/api/goals/${g.id}`, { method: 'DELETE' });
      addToast('Goal deleted', 'success');
      await load();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Delete failed', 'error');
    }
  };

  const markDone = async (g: Goal) => {
    try {
      await fetch(`/api/goals/${g.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...g, status: 'done' }),
      });
      await load();
    } catch (e) {
      addToast('Update failed', 'error');
    }
  };

  if (loading) return <div className="p-6 space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (error) return <div className="p-6"><ErrorState title="Couldn't load goals" message={error} onRetry={load} /></div>;

  const active = goals.filter(g => g.status === 'active');
  const done = goals.filter(g => g.status === 'done');

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl text-stone-900 dark:text-stone-50 flex items-center gap-3">
            <Target className="w-6 h-6 text-stone-500 dark:text-stone-400" strokeWidth={1.75} />
            Goals
          </h1>
          <p className="text-base text-stone-500 dark:text-stone-400">
            AI-suggested + self-set goals, framed in weeks of income.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-600 text-stone-900 rounded-lg text-base inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New goal
        </button>
      </div>

      {/* Income context strip */}
      {!income.loading && income.total_monthly > 0 && (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 border-l-cyan-500 rounded-2xl p-5">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">Monthly income</div>
            <div className="text-2xl text-stone-900 dark:text-stone-50 tabular-nums">${Math.round(income.total_monthly).toLocaleString()}</div>
            <div className="text-base text-stone-700 dark:text-stone-300 tabular-nums">
              ≈ 1 week of income = <span className="font-mono">${Math.round(income.total_monthly / 4.33).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* AI-suggested goals */}
      <section>
        <SectionHeader
          icon={Sparkles}
          label="AI-suggested goals"
          right={
            <button
              onClick={loadAiGoals}
              disabled={aiLoading}
              className="inline-flex items-center gap-1 text-xs text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 disabled:opacity-50"
            >
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {aiGoals.length > 0 ? 'Regenerate' : 'Generate'}
            </button>
          }
        />
        {aiGoals.length === 0 ? (
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 text-base text-stone-500 dark:text-stone-400">
            {aiLoading ? 'Kimi is thinking…' : 'Click Generate to get drawdown-mode-appropriate goals based on your current position.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {aiGoals.map(g => (
              <div key={g.name} className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-500" />
                  <span className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">AI goal</span>
                </div>
                <div className="text-lg text-stone-900 dark:text-stone-50 mb-1">{g.name}</div>
                <div className="text-base text-stone-700 dark:text-stone-300 mb-3">{g.rationale}</div>
                <div className="grid grid-cols-3 gap-2 text-xs text-stone-500 dark:text-stone-400 mb-4">
                  {g.target_amount_aud != null && <div><div className="uppercase tracking-wider">Target</div><div className="text-stone-900 dark:text-stone-100 text-base tabular-nums">{fmtAud(g.target_amount_aud)}</div></div>}
                  {g.monthly_contribution_aud != null && <div><div className="uppercase tracking-wider">Monthly</div><div className="text-stone-900 dark:text-stone-100 text-base tabular-nums">{fmtAud(g.monthly_contribution_aud)}</div></div>}
                  {g.target_date && <div><div className="uppercase tracking-wider">By</div><div className="text-stone-900 dark:text-stone-100 text-base">{g.target_date}</div></div>}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => acceptAi(g)}
                    className="flex-1 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-600 text-stone-900 rounded-lg text-base"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => dismissAi(g.name)}
                    className="flex-1 px-3 py-1.5 border border-stone-200 dark:border-stone-700 rounded-lg text-base hover:bg-stone-100 dark:hover:bg-stone-800"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Active goals */}
      <section>
        <SectionHeader label={`Active goals · ${active.length}`} />
        {active.length === 0 ? (
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 text-base text-stone-500 dark:text-stone-400">
            No active goals. Accept an AI suggestion above or click "New goal".
          </div>
        ) : (
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
            <ul className="space-y-4">
              {active.map(g => {
                const progress = g.target_amount && g.current_amount != null ? (g.current_amount / g.target_amount) * 100 : null;
                const remaining = (g.target_amount || 0) - (g.current_amount || 0);
                return (
                  <li key={g.id} className="border-b border-stone-100 dark:border-stone-800/60 pb-4 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {g.kind === 'ai' && <Sparkles className="w-3.5 h-3.5 text-cyan-500 flex-shrink-0" />}
                          <span className="text-lg text-stone-900 dark:text-stone-50">{g.name}</span>
                        </div>
                        {g.rationale && <p className="text-base text-stone-700 dark:text-stone-300 mb-2">{g.rationale}</p>}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                          {g.target_amount != null && <span className="tabular-nums">Target {fmtAud(g.target_amount)}</span>}
                          {g.current_amount != null && <span className="tabular-nums">Current {fmtAud(g.current_amount)}</span>}
                          {g.monthly_contribution != null && <span className="tabular-nums">{fmtAud(g.monthly_contribution)}/mo</span>}
                          {g.target_date && <span>By {g.target_date}</span>}
                          {g.target_amount != null && income.total_monthly > 0 && (
                            <span className="tabular-nums text-cyan-500">{weeksOfIncome(remaining > 0 ? remaining : (g.target_amount), income.total_monthly)} weeks of income to reach</span>
                          )}
                        </div>
                        {progress != null && (
                          <div className="mt-2 h-1.5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                            <div className="h-full bg-cyan-500" style={{ width: `${Math.min(progress, 100)}%` }} />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => markDone(g)} title="Mark done" className="p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 rounded text-stone-400 hover:text-emerald-600 dark:hover:text-emerald-400">
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => openEdit(g)} title="Edit" className="p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => remove(g)} title="Delete" className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded text-stone-400 hover:text-rose-600 dark:hover:text-rose-400">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* Done goals */}
      {done.length > 0 && (
        <section>
          <SectionHeader label={`Completed · ${done.length}`} />
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
            <ul className="space-y-2">
              {done.map(g => (
                <li key={g.id} className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2 text-stone-500 dark:text-stone-400 line-through">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    {g.name}
                  </span>
                  <button onClick={() => remove(g)} className="text-xs text-stone-400 hover:text-rose-500">delete</button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Create / edit modal */}
      {form && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setForm(null)}>
          <div className="bg-white dark:bg-stone-900 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg text-stone-900 dark:text-stone-50">{form.id ? 'Edit' : 'New'} goal</h3>
              <button onClick={() => setForm(null)}><X className="w-5 h-5 text-stone-400" /></button>
            </div>
            <div className="space-y-3">
              <Field label="Name *" value={form.name} onChange={v => setForm({ ...form, name: v })} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Target amount (AUD)" type="number" value={form.target_amount} onChange={v => setForm({ ...form, target_amount: v })} />
                <Field label="Current amount (AUD)" type="number" value={form.current_amount} onChange={v => setForm({ ...form, current_amount: v })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Deadline" type="date" value={form.target_date} onChange={v => setForm({ ...form, target_date: v })} />
                <Field label="Monthly contribution (AUD)" type="number" value={form.monthly_contribution} onChange={v => setForm({ ...form, monthly_contribution: v })} />
              </div>
              <div>
                <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setForm(null)} className="px-4 py-2 text-base text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg">Cancel</button>
                <button onClick={save} disabled={saving} className="px-4 py-2 text-base bg-cyan-500 hover:bg-cyan-600 text-stone-900 rounded-lg disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Field = ({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) => (
  <div>
    <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base"
    />
  </div>
);

export default Goals;
