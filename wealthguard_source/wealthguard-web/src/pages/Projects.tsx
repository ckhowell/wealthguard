import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Hammer, Plus, Edit2, Trash2, X, Home, CheckCircle2, Clock,
  TrendingUp, TrendingDown, Tag, Search, Sparkles, RefreshCw, Loader2, AlertTriangle, ArrowRight,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import Skeleton from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import { fmtAge } from '../lib/aiCache';
import { useToast } from '../hooks/usePersistentState';
import { useIncome } from '../hooks/useIncome';
import ToastContainer from '../components/ToastContainer';

interface Project {
  id: number;
  name: string;
  kind: string | null;
  property_address: string | null;
  started_at: string | null;
  completed_at: string | null;
  sale_price: number | null;
  notes: string | null;
  created_at: string;
  transaction_count: number;
  total_spend: number;
}

interface Txn {
  id: number;
  transaction_date: string;
  payee: string | null;
  amount: number;
  category: string | null;
  description: string | null;
  project_id: number | null;
  currency?: string | null;
  account_name?: string | null;
}

interface ProjectForm {
  id: number | null;
  name: string;
  kind: string;
  property_address: string;
  started_at: string;
  completed_at: string;
  sale_price: string;
  notes: string;
}

const emptyForm: ProjectForm = {
  id: null, name: '', kind: 'renovation', property_address: '',
  started_at: '', completed_at: '', sale_price: '', notes: '',
};

const fmtAud = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const fmtDate = (s: string | null) => s || '—';

const Projects = () => {
  const income = useIncome();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [projectTxns, setProjectTxns] = useState<Txn[]>([]);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [unassignedTxns, setUnassignedTxns] = useState<Txn[]>([]);
  const [taggingIds, setTaggingIds] = useState<Set<number>>(new Set());
  const [txnSearch, setTxnSearch] = useState('');
  const { toasts, addToast, removeToast } = useToast();

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to load projects');
      const data: Project[] = await res.json();
      setProjects(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProjects(); }, []);

  // When a project is selected, load its tagged transactions.
  useEffect(() => {
    if (!selectedId) { setProjectTxns([]); return; }
    fetch(`/api/transactions?limit=1000`)
      .then(r => r.ok ? r.json() : { items: [] })
      .then(d => setProjectTxns((d.items || []).filter((t: Txn) => t.project_id === selectedId)))
      .catch(() => setProjectTxns([]));
  }, [selectedId]);

  const openCreate = () => setForm({ ...emptyForm });
  const openEdit = (p: Project) => setForm({
    id: p.id,
    name: p.name,
    kind: p.kind || 'renovation',
    property_address: p.property_address || '',
    started_at: p.started_at || '',
    completed_at: p.completed_at || '',
    sale_price: p.sale_price != null ? String(p.sale_price) : '',
    notes: p.notes || '',
  });

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) { addToast('Name required', 'warning'); return; }
    setSaving(true);
    try {
      const body = JSON.stringify({
        name: form.name.trim(),
        kind: form.kind,
        property_address: form.property_address || null,
        started_at: form.started_at || null,
        completed_at: form.completed_at || null,
        sale_price: form.sale_price ? parseFloat(form.sale_price) : null,
        notes: form.notes || null,
      });
      const url = form.id ? `/api/projects/${form.id}` : '/api/projects';
      const method = form.id ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.detail || `Save failed (${res.status})`);
      }
      addToast(form.id ? 'Project updated' : 'Project created', 'success');
      setForm(null);
      await loadProjects();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Project) => {
    if (!confirm(`Delete "${p.name}"? Transactions tagged to it will be untagged (not deleted).`)) return;
    try {
      const res = await fetch(`/api/projects/${p.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      addToast('Project deleted', 'success');
      if (selectedId === p.id) setSelectedId(null);
      await loadProjects();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Delete failed', 'error');
    }
  };

  const openTagModal = async () => {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/transactions?limit=2000`);
      if (!res.ok) throw new Error('Failed to load transactions');
      const data = await res.json();
      // Show transactions NOT yet tagged; prioritise renovation-like payees
      const untagged = (data.items || []).filter((t: Txn) => t.project_id == null && t.amount < 0);
      setUnassignedTxns(untagged);
      setTaggingIds(new Set());
      setTxnSearch('');
      setTagModalOpen(true);
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Load failed', 'error');
    }
  };

  const submitTags = async () => {
    if (!selectedId || taggingIds.size === 0) return;
    try {
      const res = await fetch('/api/transactions/tag-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_ids: Array.from(taggingIds), project_id: selectedId }),
      });
      if (!res.ok) throw new Error(`Tag failed (${res.status})`);
      const d = await res.json();
      addToast(`Tagged ${d.updated} transactions`, 'success');
      setTagModalOpen(false);
      // Reload
      await loadProjects();
      fetch(`/api/transactions?limit=1000`)
        .then(r => r.ok ? r.json() : { items: [] })
        .then(d => setProjectTxns((d.items || []).filter((t: Txn) => t.project_id === selectedId)));
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Tag failed', 'error');
    }
  };

  const untagTxn = async (id: number) => {
    try {
      const res = await fetch('/api/transactions/tag-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_ids: [id], project_id: null }),
      });
      if (!res.ok) throw new Error(`Untag failed (${res.status})`);
      setProjectTxns(prev => prev.filter(t => t.id !== id));
      await loadProjects();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Untag failed', 'error');
    }
  };

  const selected = projects.find(p => p.id === selectedId) || null;
  const pnl = selected ? (selected.sale_price ?? 0) - (selected.total_spend ?? 0) : 0;
  const pnlPct = selected && selected.total_spend > 0 ? (pnl / selected.total_spend) * 100 : 0;

  const filteredUnassigned = useMemo(() => {
    if (!txnSearch.trim()) return unassignedTxns.slice(0, 500);
    const q = txnSearch.toLowerCase();
    return unassignedTxns.filter(t =>
      (t.payee || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q)
    ).slice(0, 500);
  }, [unassignedTxns, txnSearch]);

  if (loading) return <div className="p-6"><Skeleton /></div>;
  if (error) return <div className="p-6"><ErrorState message={error} /></div>;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl text-stone-900 dark:text-stone-50 flex items-center gap-3">
            <Hammer className="w-6 h-6 text-cyan-500" /> Projects
          </h1>
          <p className="text-base text-stone-500 dark:text-stone-400">Track renovations and builds; tag transactions to compute per-project P&amp;L.</p>
        </div>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg text-base inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New Project
        </button>
      </div>

      {/* ===== AI Project Cost Forecaster ===== */}
      <ProjectForecasterCard />

      {projects.length === 0 ? (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-12 text-center">
          <Hammer className="w-12 h-12 text-stone-300 dark:text-stone-700 mx-auto mb-3" />
          <p className="text-stone-600 dark:text-stone-300 mb-1">No projects yet</p>
          <p className="text-base text-stone-500 dark:text-stone-400 mb-4">Start by adding your first renovation or build.</p>
          <button onClick={openCreate} className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg text-base">
            Create your first project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Project list */}
          <div className="space-y-2">
            {projects.map(p => {
              const pnl = (p.sale_price ?? 0) - (p.total_spend ?? 0);
              const isActive = selectedId === p.id;
              return (
                <div
                  key={p.id}
                  className={`bg-white dark:bg-stone-900 rounded-lg border p-4 cursor-pointer transition-colors ${
                    isActive ? 'border-cyan-500 ring-1 ring-cyan-500' : 'border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700'
                  }`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {p.completed_at
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                          : <Clock className="w-4 h-4 text-cyan-500 flex-shrink-0" />}
                        <h3 className="text-stone-800 dark:text-stone-100 truncate">{p.name}</h3>
                      </div>
                      {p.property_address && (
                        <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 flex items-center gap-1">
                          <Home className="w-3 h-3" /> {p.property_address}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs">
                        <span className="text-stone-500 dark:text-stone-400">Spend: <span className="text-stone-700 dark:text-stone-200 ">{fmtAud(p.total_spend)}</span></span>
                        <span className="text-stone-500 dark:text-stone-400">{p.transaction_count} txns</span>
                      </div>
                      {p.sale_price && (
                        <div className="mt-1 text-base">
                          <span className={pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                            {pnl >= 0 ? <TrendingUp className="inline w-3 h-3 mr-1" /> : <TrendingDown className="inline w-3 h-3 mr-1" />}
                            P&amp;L: <strong>{fmtAud(pnl)}</strong>
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        aria-label={`Edit ${p.name}`}
                        className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-stone-400" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(p)}
                        aria-label={`Delete ${p.name}`}
                        className="p-1 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-stone-400 hover:text-rose-500" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-2">
            {selected ? (
              <div className="space-y-4">
                {/* Project summary */}
                <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-semibold text-stone-800 dark:text-stone-100">{selected.name}</h2>
                      <p className="text-base text-stone-500 dark:text-stone-400">{selected.property_address || 'No address set'} · {selected.kind || 'renovation'}</p>
                    </div>
                    <button onClick={openTagModal} className="px-3 py-1.5 border border-stone-200 dark:border-stone-700 rounded-lg text-base inline-flex items-center gap-2 hover:bg-stone-50 dark:hover:bg-stone-800">
                      <Tag className="w-4 h-4" /> Tag transactions
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Stat label="Total spend" value={fmtAud(selected.total_spend)} accent="text-rose-600 dark:text-rose-400" />
                    <Stat label="Sale price" value={fmtAud(selected.sale_price)} />
                    <Stat label="P&L" value={fmtAud(pnl)} accent={pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} sub={selected.sale_price ? `${pnlPct.toFixed(1)}% margin` : ''} />
                    <Stat
                      label="Months of income equivalent"
                      value={income.total_monthly > 0 ? `${(selected.total_spend / income.total_monthly).toFixed(1)} mo` : '—'}
                      sub={income.total_monthly > 0 ? `spend ÷ ${fmtAud(income.total_monthly)}/mo` : 'income unknown'}
                    />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-base">
                    <div><span className="text-stone-500 dark:text-stone-400">Started:</span> <span className="text-stone-700 dark:text-stone-200">{fmtDate(selected.started_at)}</span></div>
                    <div><span className="text-stone-500 dark:text-stone-400">Completed:</span> <span className="text-stone-700 dark:text-stone-200">{fmtDate(selected.completed_at)}</span></div>
                  </div>
                  {selected.notes && (
                    <p className="mt-3 text-base text-stone-600 dark:text-stone-300 p-3 bg-stone-50 dark:bg-stone-800/50 rounded">{selected.notes}</p>
                  )}
                </div>

                {/* Expense insights */}
                <ProjectInsights txns={projectTxns} project={selected} />

                {/* Tagged transactions */}
                <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">Tagged transactions ({projectTxns.length})</h3>
                  </div>
                  {projectTxns.length === 0 ? (
                    <p className="text-base text-stone-500 dark:text-stone-400 py-6 text-center">No transactions tagged yet. Click <em>Tag transactions</em> above.</p>
                  ) : (
                    <div className="max-h-[500px] overflow-y-auto">
                      <table className="w-full text-base">
                        <thead className="text-xs text-stone-500 dark:text-stone-400 uppercase border-b border-stone-200 dark:border-stone-800 sticky top-0 bg-white dark:bg-stone-900">
                          <tr>
                            <th className="text-left py-2 ">Date</th>
                            <th className="text-left ">Merchant</th>
                            <th className="text-left ">Category</th>
                            <th className="text-right ">Amount</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {projectTxns.map(t => (
                            <tr key={t.id} className="border-b border-stone-100 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800/50">
                              <td className="py-2 text-stone-500 dark:text-stone-400 whitespace-nowrap">{t.transaction_date}</td>
                              <td className="py-2 text-stone-700 dark:text-stone-200 truncate max-w-[250px]" title={t.payee || ''}>{t.payee || '—'}</td>
                              <td className="py-2 text-stone-500 dark:text-stone-400">{classifyForProject(t)}</td>
                              <td className={`py-2 text-right ${t.amount < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fmtAud(t.amount)}</td>
                              <td className="py-2 pl-2">
                                <button onClick={() => untagTxn(t.id)} className="text-xs text-stone-400 hover:text-rose-500">untag</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-12 text-center text-stone-500 dark:text-stone-400">
                <Hammer className="w-10 h-10 text-stone-300 dark:text-stone-700 mx-auto mb-3" />
                Select a project on the left to see its details.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit modal */}
      {form && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={form.id ? 'Edit project' : 'New project'}
          onClick={() => setForm(null)}
        >
          <div className="bg-white dark:bg-stone-900 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">{form.id ? 'Edit' : 'New'} Project</h3>
              <button
                type="button"
                onClick={() => setForm(null)}
                aria-label="Close"
                className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
              >
                <X className="w-5 h-5 text-stone-400" />
              </button>
            </div>
            <div className="space-y-3">
              <Field label="Name *" value={form.name} onChange={v => setForm({ ...form, name: v })} placeholder="Ansons Bay reno" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">Kind</label>
                  <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="w-full px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base">
                    <option value="renovation">Renovation</option>
                    <option value="build">New build</option>
                    <option value="flip">Flip</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <Field label="Property address" value={form.property_address} onChange={v => setForm({ ...form, property_address: v })} placeholder="143 Main St" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Started" type="date" value={form.started_at} onChange={v => setForm({ ...form, started_at: v })} />
                <Field label="Completed (if sold)" type="date" value={form.completed_at} onChange={v => setForm({ ...form, completed_at: v })} />
              </div>
              <Field label="Sale price (AUD)" type="number" value={form.sale_price} onChange={v => setForm({ ...form, sale_price: v })} placeholder="475000" />
              <div>
                <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setForm(null)} className="px-4 py-2 text-base text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg">Cancel</button>
                <button onClick={save} disabled={saving} className="px-4 py-2 text-base bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tag-transactions modal */}
      {tagModalOpen && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setTagModalOpen(false)}>
          <div className="bg-white dark:bg-stone-900 rounded-2xl p-6 w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">Tag transactions → {selected.name}</h3>
              <button onClick={() => setTagModalOpen(false)}><X className="w-5 h-5 text-stone-400" /></button>
            </div>
            <div className="flex items-center gap-2 mb-3">
              <Search className="w-4 h-4 text-stone-400" />
              <input
                type="text"
                value={txnSearch}
                onChange={e => setTxnSearch(e.target.value)}
                placeholder="Filter: Bunnings, Tools, Home Timber…"
                className="flex-1 px-3 py-1.5 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base"
              />
              <span className="text-xs text-stone-500 dark:text-stone-400">{taggingIds.size} selected</span>
            </div>
            <div className="flex-1 overflow-y-auto border border-stone-200 dark:border-stone-800 rounded-lg">
              <table className="w-full text-base">
                <thead className="text-xs text-stone-500 dark:text-stone-400 uppercase border-b border-stone-200 dark:border-stone-800 sticky top-0 bg-white dark:bg-stone-900">
                  <tr>
                    <th className="w-10 text-left py-2 px-2"></th>
                    <th className="text-left py-2 ">Date</th>
                    <th className="text-left ">Merchant</th>
                    <th className="text-left ">Category</th>
                    <th className="text-right pr-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUnassigned.map(t => {
                    const selected = taggingIds.has(t.id);
                    return (
                      <tr
                        key={t.id}
                        className={`border-b border-stone-100 dark:border-stone-800 cursor-pointer ${selected ? 'bg-cyan-50 dark:bg-cyan-800/20' : 'hover:bg-stone-50 dark:hover:bg-stone-800/50'}`}
                        onClick={() => {
                          const next = new Set(taggingIds);
                          if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                          setTaggingIds(next);
                        }}
                      >
                        <td className="py-1.5 pl-2"><input type="checkbox" checked={selected} readOnly className="accent-cyan-500" /></td>
                        <td className="py-1.5 text-stone-500 dark:text-stone-400 whitespace-nowrap">{t.transaction_date}</td>
                        <td className="py-1.5 text-stone-700 dark:text-stone-200 truncate max-w-[220px]">{t.payee || '—'}</td>
                        <td className="py-1.5 text-stone-500 dark:text-stone-400">{t.category || '—'}</td>
                        <td className={`py-1.5 text-right pr-2 ${t.amount < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fmtAud(t.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <button onClick={() => setTagModalOpen(false)} className="px-4 py-2 text-base text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg">Cancel</button>
              <button onClick={submitTags} disabled={taggingIds.size === 0} className="px-4 py-2 text-base bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg disabled:opacity-50">Tag {taggingIds.size}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Project-specific category classifier — generic transaction categories
// (Shopping / Services / Invoice) are useless for renovation analysis.
// Map by merchant patterns to reno-meaningful buckets.
// ============================================================================
const CATEGORY_PATTERNS: { label: string; patterns: RegExp[] }[] = [
  { label: 'Building materials',  patterns: [/bunnings/i, /mitre\s*10/i, /home\s*timber/i, /home\s*hardware/i, /tradetools/i, /tanktec/i, /steel/i, /timber/i, /reece/i] },
  { label: 'Electrical',          patterns: [/beresford/i, /beacon\s*lighting/i, /sparky\s*direct/i, /electrical/i, /electrician/i, /rexel/i] },
  { label: 'Plumbing',            patterns: [/spilsbury/i, /plumbing/i, /plumber/i, /tradelink/i, /reece\s*plumb/i] },
  { label: 'Tiles & flooring',    patterns: [/beaumont\s*tiles/i, /tile/i, /carpet/i, /simons/i, /flooring/i] },
  { label: 'Landscaping & site',  patterns: [/geo[-\s]*environmental/i, /landscape/i, /landscap/i, /st\s*helens/i, /excavat/i, /turf/i] },
  { label: 'Appliances & AV',     patterns: [/good\s*guys/i, /harvey\s*norman/i, /jb\s*hi[-\s]*fi/i, /appliance/i] },
  { label: 'Kitchen & bathroom',  patterns: [/ikea/i, /kitchen/i, /bathroom/i, /vanity/i, /acqua/i] },
  { label: 'Tools',               patterns: [/sydney\s*tools/i, /total\s*tools/i, /toolkit/i] },
  { label: 'Council & permits',   patterns: [/council/i, /break\s*o\s*day/i, /permit/i, /certifier/i, /surveyor/i] },
  { label: 'Trades & labour',     patterns: [/labour/i, /carpenter/i, /builder/i, /painter/i, /tradesman/i] },
];

function classifyForProject(t: Txn): string {
  const hay = `${t.payee || ''} ${t.description || ''}`;
  for (const { label, patterns } of CATEGORY_PATTERNS) {
    if (patterns.some((re) => re.test(hay))) return label;
  }
  if ((t.category || '').toLowerCase() === 'invoice') return 'Other invoices';
  return 'Misc / unclassified';
}

// ============================================================================
// Expense insights — categories, merchants, monthly trend, big-ticket items
// ============================================================================
interface InsightProps { txns: Txn[]; project: Project }

const ProjectInsights = ({ txns, project }: InsightProps) => {
  const insights = useMemo(() => {
    const expenses = txns.filter(t => t.amount < 0);
    if (expenses.length === 0) return null;

    const total = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);

    // Group by month YYYY-MM
    const byMonth = new Map<string, number>();
    for (const t of expenses) {
      const m = (t.transaction_date || '').slice(0, 7);
      if (!m) continue;
      byMonth.set(m, (byMonth.get(m) ?? 0) + Math.abs(t.amount));
    }
    const monthly = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, amount, label: month.slice(2).replace('-', '/') }));
    const monthsActive = monthly.length || 1;
    const avgPerMonth = total / monthsActive;
    const maxMonthly = monthly.length ? Math.max(...monthly.map(m => m.amount)) : 0;
    const peakMonth = monthly.find(m => m.amount === maxMonthly);

    // Group by project-specific category (merchant-pattern classifier).
    const byCat = new Map<string, { amount: number; count: number }>();
    for (const t of expenses) {
      const k = classifyForProject(t);
      const cur = byCat.get(k) ?? { amount: 0, count: 0 };
      cur.amount += Math.abs(t.amount);
      cur.count += 1;
      byCat.set(k, cur);
    }
    const topCats = [...byCat.entries()]
      .sort(([, a], [, b]) => b.amount - a.amount)
      .slice(0, 8)
      .map(([name, v]) => ({ name, ...v, pct: (v.amount / total) * 100 }));

    // Group by merchant (payee)
    const byMerch = new Map<string, { amount: number; count: number }>();
    for (const t of expenses) {
      const k = (t.payee || 'Unknown').trim() || 'Unknown';
      const cur = byMerch.get(k) ?? { amount: 0, count: 0 };
      cur.amount += Math.abs(t.amount);
      cur.count += 1;
      byMerch.set(k, cur);
    }
    const topMerchants = [...byMerch.entries()]
      .sort(([, a], [, b]) => b.amount - a.amount)
      .slice(0, 8)
      .map(([name, v]) => ({ name, ...v, pct: (v.amount / total) * 100 }));

    // Largest single line items
    const biggest = [...expenses]
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 5);

    // Pace vs sale price
    const target = project.sale_price ?? 0;
    const paceVsTarget = target > 0 ? (total / target) * 100 : null;

    return {
      total, avgPerMonth, monthsActive, monthly, maxMonthly, peakMonth,
      topCats, topMerchants, biggest, paceVsTarget,
    };
  }, [txns, project.sale_price]);

  if (!insights) {
    return (
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6 text-base text-stone-500 dark:text-stone-400">
        No expenses tagged yet — insights will appear here.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-6 space-y-5">
      <div>
        <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">Expense insights</h3>
        <p className="text-xs text-stone-500 dark:text-stone-400">Breakdown of where the project money is going.</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Avg / month" value={fmtAud(insights.avgPerMonth)} sub={`over ${insights.monthsActive} mo`} />
        <KpiTile
          label="Peak month"
          value={fmtAud(insights.maxMonthly)}
          sub={insights.peakMonth?.month || '—'}
        />
        <KpiTile
          label="Largest single"
          value={fmtAud(Math.abs(insights.biggest[0]?.amount ?? 0))}
          sub={(insights.biggest[0]?.payee || '').slice(0, 22) || '—'}
        />
        <KpiTile
          label="Pace vs sale target"
          value={insights.paceVsTarget != null ? `${insights.paceVsTarget.toFixed(1)}%` : '—'}
          sub={project.sale_price ? `of ${fmtAud(project.sale_price)}` : 'set sale price'}
          accent={insights.paceVsTarget != null && insights.paceVsTarget > 80 ? 'text-rose-600' : undefined}
        />
      </div>

      {/* Monthly trend chart */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Monthly spend</h4>
          <span className="text-xs text-stone-400">avg line in amber</span>
        </div>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={insights.monthly} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'currentColor' }} className="text-stone-500 dark:text-stone-400" />
              <YAxis tick={{ fontSize: 10, fill: 'currentColor' }} className="text-stone-500 dark:text-stone-400" tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
              <Tooltip
                cursor={{ fill: 'rgba(120,113,108,0.08)' }}
                contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 6, fontSize: 12 }}
                formatter={(v: number) => [fmtAud(v), 'Spend']}
              />
              <ReferenceLine y={insights.avgPerMonth} stroke="#00E5FF" strokeDasharray="3 3" />
              <Bar dataKey="amount" radius={[3, 3, 0, 0]}>
                {insights.monthly.map((m, i) => (
                  <Cell key={i} fill={m.amount === insights.maxMonthly ? '#dc2626' : '#78716c'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Categories + merchants side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-2">Top categories</h4>
          <ul className="space-y-2">
            {insights.topCats.map(c => (
              <li key={c.name}>
                <div className="flex items-baseline justify-between text-base">
                  <span className="text-stone-700 dark:text-stone-200 truncate" title={c.name}>{c.name}</span>
                  <span className="text-stone-500 dark:text-stone-400 tabular-nums ml-2">{fmtAud(c.amount)} <span className="text-stone-400 text-xs">· {c.pct.toFixed(0)}%</span></span>
                </div>
                <div className="h-1.5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500" style={{ width: `${c.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-2">Top merchants</h4>
          <ul className="space-y-2">
            {insights.topMerchants.map(m => (
              <li key={m.name}>
                <div className="flex items-baseline justify-between text-base">
                  <span className="text-stone-700 dark:text-stone-200 truncate" title={m.name}>{m.name}</span>
                  <span className="text-stone-500 dark:text-stone-400 tabular-nums ml-2">{fmtAud(m.amount)} <span className="text-stone-400 text-xs">· {m.count}×</span></span>
                </div>
                <div className="h-1.5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                  <div className="h-full bg-stone-600" style={{ width: `${m.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Biggest single transactions */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-2">Biggest single transactions</h4>
        <ul className="divide-y divide-stone-100 dark:divide-stone-800">
          {insights.biggest.map(t => (
            <li key={t.id} className="py-2 flex items-center justify-between gap-3 text-base">
              <div className="min-w-0">
                <div className="text-stone-700 dark:text-stone-200 truncate">{t.payee || '—'}</div>
                <div className="text-xs text-stone-500 dark:text-stone-400">{t.transaction_date} · {t.category || 'Uncategorised'}</div>
              </div>
              <div className="tabular-nums text-rose-600 dark:text-rose-400 whitespace-nowrap">{fmtAud(Math.abs(t.amount))}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

const KpiTile = ({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) => (
  <div className="bg-stone-50 dark:bg-stone-800/50 rounded-lg p-3">
    <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</div>
    <div className={`text-base font-semibold mt-0.5 tabular-nums ${accent || 'text-stone-800 dark:text-stone-100'}`}>{value}</div>
    {sub && <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 truncate" title={sub}>{sub}</div>}
  </div>
);

const Stat = ({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) => (
  <div className="bg-stone-50 dark:bg-stone-800/50 rounded-lg p-3">
    <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</div>
    <div className={`text-lg font-semibold mt-0.5 ${accent || 'text-stone-800 dark:text-stone-100'}`}>{value}</div>
    {sub && <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{sub}</div>}
  </div>
);

const Field = ({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) => (
  <div>
    <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-base"
    />
  </div>
);

// ============================================================================
// AI Project Cost Forecaster card
//
// Pulls /api/intel/project-forecaster — velocity stats + plan-date gap
// detection + Kimi narrative.  Designed to sit at the top of Projects page,
// above the project list, so the first thing the user sees is what matters:
// which project is slipping + what single data gap to close in the Plan page.
// ============================================================================
interface ForecastProject {
  project_id: number;
  name: string;
  status: string;
  budget_aud: number;
  budget_source: string;
  spent_to_date: number;
  pct_complete: number;
  remaining_aud: number;
  velocity_30d_per_mo: number;
  velocity_90d_per_mo: number;
  transaction_count: number;
  implied_months_to_complete: number | null;
  overrun_risk: string;
  date_gaps: string[];
}

interface ForecastResp {
  as_of: string;
  projects: ForecastProject[];
  plan_gaps: string[];
  total_budget_aud: number;
  total_spent_aud: number;
  total_remaining_aud: number;
  narrative: string;
  narrative_provider: string;
  error?: string;
  // Iteration 22 cache-meta. See src/lib/aiCache.ts.
  cached?: false;
  _cached_at?: string | null;
  _age_seconds?: number;
  _stale?: boolean;
}

const fmtAudInline = (v: number) =>
  (v ?? 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

const riskStyle = (risk: string): { label: string; className: string } => {
  switch (risk) {
    case 'over':      return { label: 'OVER BUDGET', className: 'text-rose-600 dark:text-rose-400' };
    case 'hot_burn':  return { label: 'FAST BURN',   className: 'text-yellow-600 dark:text-yellow-400' };
    case 'on_track':  return { label: 'ON TRACK',    className: 'text-cyan-600 dark:text-cyan-400' };
    case 'finishing': return { label: 'FINISHING',   className: 'text-emerald-600 dark:text-emerald-400' };
    case 'early':     return { label: 'EARLY',       className: 'text-stone-500 dark:text-stone-400' };
    default:          return { label: risk.toUpperCase(), className: 'text-stone-500 dark:text-stone-400' };
  }
};

const ProjectForecasterCard = () => {
  const [data, setData] = useState<ForecastResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Iteration 22: cache-only on mount, button to actually re-run.
  const load = async (mode: 'mount' | 'fresh' = 'mount') => {
    setLoading(true);
    setErr(null);
    try {
      const qs = mode === 'fresh' ? '?force=true' : '?cache_only=true';
      const res = await fetch(`/api/intel/project-forecaster${qs}`);
      if (!res.ok) throw new Error(`forecaster ${res.status}`);
      const json: ForecastResp = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
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
          <Sparkles className="w-3.5 h-3.5 text-cyan-500" /> AI Project Cost Forecaster
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
          {loading ? 'Forecasting' : (noCache ? 'Run analysis' : 'Re-scan')}
        </button>
      </div>

      {err ? (
        <ErrorState title="Forecaster unavailable" message={err} onRetry={() => load('fresh')} />
      ) : noCache ? (
        <p className="text-base text-stone-500 dark:text-stone-400">
          No forecast yet — click <span className="text-cyan-600 dark:text-cyan-400">Run analysis</span> to score project velocity, surface plan-date gaps, and produce a Kimi action recommendation.
        </p>
      ) : !data ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          {/* Plan-date gaps — red-bordered note, only shows if any are null */}
          {data.plan_gaps.length > 0 && (
            <div className="mb-4 border border-rose-200 dark:border-rose-900/40 border-l-2 border-l-rose-500 rounded-lg p-3">
              <div className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-rose-600 dark:text-rose-400 mb-1">
                <AlertTriangle className="w-3 h-3" /> Plan-date gaps affecting simulator accuracy
              </div>
              <ul className="text-base text-stone-900 dark:text-stone-100 space-y-1">
                {data.plan_gaps.map((g, i) => <li key={i} className="leading-snug">• {g}</li>)}
              </ul>
              <Link
                to="/plan"
                className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
              >
                Fix in Plan page <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          )}

          {/* Per-project rows */}
          <div className="space-y-3 mb-4">
            {data.projects.map((p) => {
              const r = riskStyle(p.overrun_risk);
              const bar = Math.min(100, p.pct_complete);
              return (
                <div key={p.project_id} className="border border-stone-200 dark:border-stone-800 rounded-lg p-3">
                  <div className="flex items-baseline justify-between gap-3 mb-1.5">
                    <div className="text-base text-stone-900 dark:text-stone-100">{p.name}</div>
                    <span className={`text-xs font-mono uppercase tracking-wider ${r.className}`}>{r.label}</span>
                  </div>
                  <div className="text-xs text-stone-500 dark:text-stone-400 font-mono tabular-nums mb-2">
                    {fmtAudInline(p.spent_to_date)} / {fmtAudInline(p.budget_aud)}
                    {' · '}{p.pct_complete.toFixed(0)}% complete
                    {' · '}{p.transaction_count} txns
                    {p.velocity_30d_per_mo > 0 && (
                      <>{' · '}30d vel {fmtAudInline(p.velocity_30d_per_mo)}/mo</>
                    )}
                    {p.implied_months_to_complete != null && p.remaining_aud > 0 && (
                      <>{' · '}~{p.implied_months_to_complete} mo to complete</>
                    )}
                  </div>
                  <div className="h-1.5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${p.overrun_risk === 'over' ? 'bg-rose-500' : p.overrun_risk === 'hot_burn' ? 'bg-yellow-500' : 'bg-cyan-500'}`}
                      style={{ width: `${bar}%` }}
                      aria-label={`${p.name}: ${p.pct_complete.toFixed(0)}% of budget spent`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Narrative */}
          <p className="text-base text-stone-900 dark:text-stone-100 leading-relaxed">
            {data.narrative}
          </p>

          <div className="mt-3 flex items-center gap-3 text-xs font-mono uppercase tracking-wider text-stone-400 dark:text-stone-500">
            <span>
              total budget {fmtAudInline(data.total_budget_aud)} · spent {fmtAudInline(data.total_spent_aud)} · remaining {fmtAudInline(data.total_remaining_aud)}
            </span>
            <span className="ml-auto">
              scanned {new Date(data.as_of).toLocaleString('en-AU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

// Named alias — used by the consolidated `/plan` page (tab-based sub-nav,
// see App.tsx routing strategy). Same component, different export name keeps
// the standalone /projects route working as a redirect target without
// duplicating logic.
export const ProjectsView = Projects;

export default Projects;
