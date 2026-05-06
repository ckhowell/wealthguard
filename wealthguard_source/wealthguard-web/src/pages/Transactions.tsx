import { useEffect, useMemo, useState } from 'react';
import { Search, Download, ArrowUpRight, ArrowDownRight, Loader2, Repeat } from 'lucide-react';
import { Link } from 'react-router-dom';
import Skeleton from '../components/Skeleton';
import ErrorState from '../components/ErrorState';

interface TransactionRow {
  id: number;
  account_id: number;
  account_name: string | null;
  transaction_date: string;
  posted_date?: string | null;
  payee: string;
  amount: number;
  currency: string;
  category: string | null;
  subcategory?: string | null;
  description?: string | null;
  transaction_type: 'debit' | 'credit' | 'transfer' | string;
  import_source?: string | null;
  is_recurring?: boolean | number | null;
}

interface TransactionsResponse {
  total: number;
  items: TransactionRow[];
}

const Transactions = () => {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [account, setAccount] = useState<string>('All');
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/transactions?limit=500');
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data: TransactionsResponse = await res.json();
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const categories = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.category && s.add(r.category));
    return ['All', ...Array.from(s).sort()];
  }, [rows]);

  const accounts = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.account_name && s.add(r.account_name));
    return ['All', ...Array.from(s).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return rows.filter((r) => {
      if (category !== 'All' && r.category !== category) return false;
      if (account !== 'All' && r.account_name !== account) return false;
      if (recurringOnly && !(r.is_recurring === 1 || r.is_recurring === true)) return false;
      if (q) {
        const hay = `${r.payee} ${r.description ?? ''} ${r.category ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, category, account, recurringOnly, searchTerm]);

  const detectRecurring = async () => {
    setDetecting(true);
    try {
      const res = await fetch('/api/transactions/detect-recurring', { method: 'POST' });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Detection failed');
    } finally {
      setDetecting(false);
    }
  };

  const totalCredits = filtered
    .filter((t) => t.transaction_type === 'credit')
    .reduce((s, t) => s + t.amount, 0);
  const totalDebits = filtered
    .filter((t) => t.transaction_type === 'debit')
    .reduce((s, t) => s + t.amount, 0);

  const exportCsv = () => {
    const header = ['Date', 'Account', 'Payee', 'Category', 'Amount', 'Type', 'Currency'];
    const lines = [header.join(',')];
    for (const r of filtered) {
      const cells = [
        r.transaction_date,
        r.account_name ?? '',
        r.payee.replace(/"/g, '""'),
        r.category ?? '',
        r.amount.toString(),
        r.transaction_type,
        r.currency,
      ].map((c) => (/[,"\n]/.test(c) ? `"${c}"` : c));
      lines.push(cells.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {error && <ErrorState title="Couldn't load transactions" message={error} onRetry={load} />}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6">
          <p className="text-base text-stone-500 dark:text-stone-400">Showing</p>
          {loading ? (
            <Skeleton className="h-7 w-24 mt-2" />
          ) : (
            <p className="text-2xl font-bold text-stone-800 dark:text-stone-100">
              {filtered.length.toLocaleString()} / {total.toLocaleString()}
            </p>
          )}
        </div>
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6">
          <p className="text-base text-stone-500 dark:text-stone-400">Credits</p>
          {loading ? (
            <Skeleton className="h-7 w-32 mt-2" />
          ) : (
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">+${totalCredits.toLocaleString()}</p>
          )}
        </div>
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6">
          <p className="text-base text-stone-500 dark:text-stone-400">Debits</p>
          {loading ? (
            <Skeleton className="h-7 w-32 mt-2" />
          ) : (
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">-${totalDebits.toLocaleString()}</p>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400 dark:text-stone-500" />
            <input
              type="text"
              placeholder="Search payee, description, category…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-4 py-2 border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="px-4 py-2 border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            {accounts.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setRecurringOnly((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              recurringOnly
                ? 'bg-cyan-500 text-stone-900'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-700'
            }`}
            title="Only show transactions flagged as recurring"
          >
            <Repeat className="w-4 h-4" />
            Recurring
          </button>

          <button
            type="button"
            onClick={detectRecurring}
            disabled={detecting}
            className="flex items-center gap-2 px-4 py-2 bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 rounded-lg hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
            title="Scan transactions and flag recurring buckets"
          >
            {detecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Repeat className="w-4 h-4" />}
            Detect
          </button>

          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 rounded-lg hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-base">
            <thead className="bg-stone-50 dark:bg-stone-800 border-b border-stone-200 dark:border-stone-800">
              <tr>
                <th className="text-left py-4 px-6 text-base text-stone-500 dark:text-stone-400">Date</th>
                <th className="text-left py-4 px-6 text-base text-stone-500 dark:text-stone-400">Account</th>
                <th className="text-left py-4 px-6 text-base text-stone-500 dark:text-stone-400">Payee</th>
                <th className="text-left py-4 px-6 text-base text-stone-500 dark:text-stone-400">Category</th>
                <th className="text-right py-4 px-6 text-base text-stone-500 dark:text-stone-400">Amount</th>
                <th className="text-center py-4 px-6 text-base text-stone-500 dark:text-stone-400">Type</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i} className="border-b border-stone-100 dark:border-stone-800">
                    {[0, 1, 2, 3, 4, 5].map((j) => (
                      <td key={j} className="py-4 px-6">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-stone-500 dark:text-stone-400">
                    <p className="mb-3">No transactions match these filters.</p>
                    <Link to="/import" className="text-cyan-500 dark:text-cyan-400 underline">
                      Import a CSV
                    </Link>
                  </td>
                </tr>
              ) : (
                filtered.map((t) => {
                  const isIncome = t.amount > 0 && t.transaction_type !== 'transfer';
                  return (
                  <tr
                    key={t.id}
                    className={`border-b border-stone-100 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors ${isIncome ? 'border-l-2 border-l-emerald-500' : ''}`}
                  >
                    <td className="py-4 px-6 text-base text-stone-600 dark:text-stone-300 whitespace-nowrap">
                      {t.transaction_date}
                    </td>
                    <td className="py-4 px-6 text-base text-stone-800 dark:text-stone-100 whitespace-nowrap">
                      {t.account_name ?? '—'}
                    </td>
                    <td className="py-4 px-6 text-base text-stone-800 dark:text-stone-100">
                      {t.payee}
                    </td>
                    <td className="py-4 px-6">
                      {t.category && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200">
                          {t.category}
                        </span>
                      )}
                    </td>
                    <td
                      className={`py-4 px-6 text-base font-bold text-right whitespace-nowrap ${
                        t.transaction_type === 'credit' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {t.transaction_type === 'credit' ? '+' : '-'}${t.amount.toLocaleString()}{' '}
                      <span className="font-normal text-xs text-stone-400">{t.currency}</span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <div className="inline-flex items-center gap-2">
                        {t.transaction_type === 'credit' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-base">
                            <ArrowUpRight className="w-4 h-4" /> Credit
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 text-base">
                            <ArrowDownRight className="w-4 h-4" /> Debit
                          </span>
                        )}
                        {(t.is_recurring === 1 || t.is_recurring === true) && (
                          <span
                            title="Recurring"
                            className="inline-flex items-center text-cyan-500 dark:text-cyan-400"
                          >
                            <Repeat className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {loading && (
          <div className="py-4 text-center text-xs text-stone-500 dark:text-stone-400 flex items-center justify-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading transactions…
          </div>
        )}
      </div>
    </div>
  );
};

export default Transactions;
