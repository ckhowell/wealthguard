import { useMemo, useRef, useState, useEffect } from 'react';
import Papa from 'papaparse';
import { Upload, CheckCircle, AlertTriangle, FileText, Loader2 } from 'lucide-react';
import ErrorState from '../components/ErrorState';
import { useToast } from '../hooks/usePersistentState';
import ToastContainer from '../components/ToastContainer';

interface AccountRow {
  id: number;
  name: string;
  type: string;
  currency: string;
}

type MappingKey = 'date' | 'payee' | 'amount' | 'category';

const DETECT_HINTS: Record<MappingKey, string[]> = {
  date: ['date', 'transaction date', 'posted date'],
  payee: ['payee', 'description', 'merchant', 'name'],
  amount: ['amount', 'value', 'debit', 'credit'],
  category: ['category', 'type'],
};

function detect(columns: string[], key: MappingKey): string | '' {
  const lc = columns.map((c) => c.toLowerCase());
  for (const hint of DETECT_HINTS[key]) {
    const idx = lc.indexOf(hint);
    if (idx >= 0) return columns[idx];
  }
  for (const c of columns) {
    if (DETECT_HINTS[key].some((h) => c.toLowerCase().includes(h))) return c;
  }
  return '';
}

interface ImportResult {
  imported: number;
  skipped: number;
  account_id?: number | null;
}

const Import = () => {
  const { toasts, addToast, removeToast } = useToast();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<MappingKey, string>>({
    date: '',
    payee: '',
    amount: '',
    category: '',
  });
  const [accountName, setAccountName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AccountRow[]) => setAccounts(data))
      .catch(() => setAccounts([]));
  }, []);

  const handleFile = (f: File) => {
    setError(null);
    setResult(null);
    setFile(f);
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: true,
      preview: 5,
      complete: (results) => {
        const cols = results.meta.fields ?? [];
        setColumns(cols);
        setPreview(results.data);
        setMapping({
          date: detect(cols, 'date'),
          payee: detect(cols, 'payee'),
          amount: detect(cols, 'amount'),
          category: detect(cols, 'category'),
        });
      },
      error: (e) => setError(e.message),
    });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const ready = useMemo(
    () => Boolean(file && accountName && mapping.date && mapping.payee && mapping.amount),
    [file, accountName, mapping],
  );

  const submit = async () => {
    if (!file) return;
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('account_name', accountName);
      const res = await fetch('/api/transactions/import', { method: 'POST', body: form });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Import failed (${res.status}): ${detail.slice(0, 200)}`);
      }
      const data: ImportResult = await res.json();
      setResult(data);
      addToast(`Imported ${data.imported} transactions (${data.skipped} skipped)`, 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Import failed';
      setError(msg);
      addToast(msg, 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-3xl text-stone-900 dark:text-stone-50">Import Transactions</h1>
        <p className="text-base text-stone-500 dark:text-stone-400 mt-1">
          Drop a bank CSV, confirm the column mapping, and import. Duplicate rows are skipped.
        </p>
      </header>

      {error && <ErrorState title="Import failed" message={error} onRetry={submit} />}

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInput.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click();
        }}
        className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${
          isDragging
            ? 'border-cyan-400 bg-cyan-50 dark:bg-cyan-900/30'
            : 'border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 hover:border-cyan-300'
        }`}
      >
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <Upload className="w-8 h-8 mx-auto text-stone-400 dark:text-stone-500" />
        <p className="mt-3 text-base text-stone-700 dark:text-stone-200">
          {file ? (
            <>
              <FileText className="inline w-4 h-4 mr-1" />
              {file.name} · {Math.round(file.size / 1024)} KB
            </>
          ) : (
            <>Drop a .csv here, or click to browse</>
          )}
        </p>
      </div>

      {columns.length > 0 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6 space-y-4">
          <div>
            <h2 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">Map columns</h2>
            <p className="text-base text-stone-500 dark:text-stone-400">
              We guessed the columns below. Adjust if needed.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(Object.keys(mapping) as MappingKey[]).map((key) => (
              <label key={key} className="block">
                <span className="block text-base text-stone-700 dark:text-stone-200 capitalize">
                  {key}
                  {key === 'category' && <span className="text-xs text-stone-500 dark:text-stone-400 ml-1">(optional)</span>}
                </span>
                <select
                  value={mapping[key]}
                  onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}
                  className="mt-1 w-full border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg px-3 py-2 text-base"
                >
                  <option value="">—</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div>
            <span className="block text-base text-stone-700 dark:text-stone-200">Account</span>
            <div className="mt-1 flex gap-2">
              <select
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="flex-1 border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg px-3 py-2 text-base"
              >
                <option value="">Select an account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.name} ({a.type}, {a.currency})
                  </option>
                ))}
                <option value="__new__">➕ Create new account…</option>
              </select>
              {accountName === '__new__' && (
                <input
                  type="text"
                  placeholder="New account name"
                  onChange={(e) => setAccountName(e.target.value)}
                  className="flex-1 border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg px-3 py-2 text-base"
                />
              )}
            </div>
          </div>

          {/* Preview */}
          <div>
            <h3 className="text-base text-stone-700 dark:text-stone-200 mb-2">Preview (first 5 rows)</h3>
            <div className="overflow-x-auto border border-stone-200 dark:border-stone-800 rounded-lg">
              <table className="min-w-full text-base">
                <thead className="bg-stone-50 dark:bg-stone-800">
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className="px-3 py-2 text-left text-stone-600 dark:text-stone-300 whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-t border-stone-100 dark:border-stone-800">
                      {columns.map((c) => (
                        <td key={c} className="px-3 py-2 text-stone-700 dark:text-stone-200 whitespace-nowrap">
                          {row[c] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={!ready || importing}
              className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 disabled:opacity-50"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Import
            </button>
            {!ready && !importing && (
              <span className="text-xs text-stone-500 dark:text-stone-400 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Pick an account and map date / payee / amount.
              </span>
            )}
            {result && (
              <span className="text-base text-green-700 dark:text-green-300 flex items-center gap-1">
                <CheckCircle className="w-4 h-4" />
                Imported {result.imported} · skipped {result.skipped}
              </span>
            )}
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
};

export default Import;
