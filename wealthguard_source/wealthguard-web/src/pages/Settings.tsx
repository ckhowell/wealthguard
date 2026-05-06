import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Download, Database, Palette, Lock, PlugZap, Loader2, CheckCircle, XCircle, Key, Eye, EyeOff, Send, RefreshCw, MessageSquare } from 'lucide-react';
import ErrorState from '../components/ErrorState';
import ToastContainer from '../components/ToastContainer';
import ThemeToggle from '../components/ThemeToggle';
import Skeleton from '../components/Skeleton';
import { useToast } from '../hooks/usePersistentState';
import { usePersistentState } from '../hooks/usePersistentState';
import { getStoredPassword, setStoredPassword } from '../services/apiClient';

interface HealthResponse {
  api: string;
  database: 'ok' | { error: string } | string;
  last_sync: Record<string, unknown> | null;
  providers: Record<string, 'configured' | 'missing'>;
  whisper?: string;
  auth?: string;
  checked_at: string;
}

interface SyncRun {
  id: number;
  started_at: string;
  completed_at?: string;
  status: string;
  holdings_count?: number;
  success_count?: number;
  fail_count?: number;
  duration_seconds?: number;
}

const Settings = () => {
  const { toasts, addToast, removeToast } = useToast();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [history, setHistory] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaultFx, setDefaultFx] = usePersistentState<string>('wealthguard-default-fx', 'USD/AUD');
  const [passwordDraft, setPasswordDraft] = useState(getStoredPassword());
  const [downloading, setDownloading] = useState(false);
  const [exportingJson, setExportingJson] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [hRes, sRes] = await Promise.all([
        fetch('/api/health'),
        fetch('/api/sync/history?limit=5'),
      ]);
      if (!hRes.ok) throw new Error(`/api/health ${hRes.status}`);
      setHealth(await hRes.json());
      setHistory(sRes.ok ? await sRes.json() : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const savePassword = () => {
    setStoredPassword(passwordDraft);
    addToast(
      passwordDraft
        ? 'Password saved (will be sent on every API request)'
        : 'Password cleared — requests will be sent unauthenticated',
      'success'
    );
  };

  const downloadDb = async () => {
    setDownloading(true);
    try {
      const res = await fetch('/api/export/all');
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wealthguard-${new Date().toISOString().slice(0, 10)}.db`;
      a.click();
      URL.revokeObjectURL(url);
      addToast(`Database saved (${Math.round(blob.size / 1024)} KB)`, 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Download failed', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const exportJson = async () => {
    setExportingJson(true);
    try {
      const [holdings, accounts, txns, goals] = await Promise.all([
        fetch('/api/holdings').then((r) => r.json()),
        fetch('/api/accounts').then((r) => r.json()),
        fetch('/api/transactions?limit=10000').then((r) => r.json()),
        fetch('/api/goals').then((r) => r.json()),
      ]);
      const payload = {
        exported_at: new Date().toISOString(),
        holdings,
        accounts,
        transactions: txns,
        goals,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wealthguard-portfolio-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      addToast('Portfolio JSON exported', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Export failed', 'error');
    } finally {
      setExportingJson(false);
    }
  };

  const providerRow = (name: string, label: string, envKey: string) => (
    <ProviderRow
      key={name}
      name={name}
      label={label}
      envKey={envKey}
      configured={health?.providers?.[name] === 'configured'}
      onSaved={(ok, provider) => {
        addToast(
          ok ? `${label} key saved` : `Could not save ${label} key`,
          ok ? 'success' : 'error',
        );
        if (ok) {
          // Optimistic: mark configured without waiting for next poll.
          setHealth((h) =>
            h
              ? { ...h, providers: { ...h.providers, [provider]: 'configured' } }
              : h,
          );
          load();
        }
      }}
    />
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-3xl text-stone-900 dark:text-stone-50 flex items-center gap-3">
          <SettingsIcon className="w-6 h-6 text-cyan-500" />
          Settings
        </h1>
        <p className="text-base text-stone-500 dark:text-stone-400 mt-1">
          Preferences, data export, integration health, and sync history.
        </p>
      </header>

      {error && <ErrorState title="Couldn't load settings" message={error} onRetry={load} />}

      {/* Display */}
      <section className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-cyan-500" />
          <h2 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">Display</h2>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-base text-stone-700 dark:text-stone-200">Theme</p>
            <p className="text-xs text-stone-500 dark:text-stone-400">Light / Dark / System</p>
          </div>
          <ThemeToggle />
        </div>
        <div>
          <label className="text-base text-stone-700 dark:text-stone-200">Default FX pair</label>
          <select
            value={defaultFx}
            onChange={(e) => setDefaultFx(e.target.value)}
            className="mt-1 w-full sm:w-48 text-base border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg px-3 py-2"
          >
            <option value="USD/AUD">USD → AUD</option>
            <option value="AUD/USD">AUD → USD</option>
            <option value="JPY/AUD">JPY → AUD</option>
            <option value="EUR/AUD">EUR → AUD</option>
          </select>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            Used by the CurrencyConverter default.
          </p>
        </div>
      </section>

      {/* Data */}
      <section className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-cyan-500" />
          <h2 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">Data</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={downloadDb}
            disabled={downloading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 disabled:opacity-50 text-base"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download database
          </button>
          <button
            type="button"
            onClick={exportJson}
            disabled={exportingJson}
            className="inline-flex items-center gap-2 px-4 py-2 bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 rounded-lg hover:bg-stone-200 dark:hover:bg-stone-700 disabled:opacity-50 text-base"
          >
            {exportingJson ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export portfolio JSON
          </button>
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          "Download database" returns the raw SQLite file — open it with any SQLite browser. "Export portfolio JSON" bundles holdings + accounts + transactions + goals.
        </p>
      </section>

      {/* Integrations */}
      <section className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6 space-y-3">
        <div className="flex items-center gap-2">
          <PlugZap className="w-5 h-5 text-cyan-500" />
          <h2 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">Integrations</h2>
        </div>
        {loading && !health ? (
          <>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </>
        ) : (
          <div className="space-y-2">
            {providerRow('kimi', 'Kimi / Moonshot', 'KIMI_API_KEY')}
            {providerRow('gemini', 'Google Gemini', 'GEMINI_API_KEY')}
            {providerRow('qwen', 'Qwen', 'QWEN_API_KEY')}
            {providerRow('openai', 'OpenAI (Whisper + fallback summariser)', 'OPENAI_API_KEY')}
            {providerRow('newsapi', 'NewsAPI.ai', 'NEWSAPI_KEY')}
            {providerRow('gnews', 'GNews', 'GNEWS_KEY')}
            {providerRow('finnhub', 'Finnhub (US stocks)', 'FINNHUB_API_KEY')}
            {providerRow('alpha_vantage', 'Alpha Vantage (stocks fallback)', 'ALPHA_VANTAGE_API_KEY')}
            {providerRow('telegram', 'Telegram alerts', 'TELEGRAM_BOT_TOKEN')}
            {providerRow('etherscan', 'Etherscan (ETH staking rewards)', 'ETHERSCAN_API_KEY')}
            {providerRow('solscan', 'Solscan (SOL staking rewards — Pro API)', 'SOLSCAN_API_KEY')}
            {providerRow('helius', 'Helius (SOL RPC — alternative)', 'HELIUS_API_KEY')}
            <p className="text-xs text-stone-500 dark:text-stone-400 pt-1">
              Whisper is {health?.whisper ?? 'disabled'}. Set <code className="text-xs px-1 py-0.5 bg-stone-200 dark:bg-stone-800 rounded">WHISPER_ENABLED=true</code> + <code className="text-xs px-1 py-0.5 bg-stone-200 dark:bg-stone-800 rounded">OPENAI_API_KEY</code> to transcribe podcast audio.
            </p>
          </div>
        )}
      </section>

      {/* Daily brief (Telegram) */}
      <TelegramBriefPanel />

      {/* Auth */}
      <section className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-cyan-500" />
          <h2 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">Auth (optional)</h2>
        </div>
        <p className="text-base text-stone-500 dark:text-stone-400">
          When <code className="text-xs px-1 py-0.5 bg-stone-100 dark:bg-stone-800 rounded">WEALTHGUARD_PASSWORD</code> is set on the backend, every <code className="text-xs px-1 py-0.5 bg-stone-100 dark:bg-stone-800 rounded">/api/*</code> call requires the same value in an <code className="text-xs px-1 py-0.5 bg-stone-100 dark:bg-stone-800 rounded">x-wg-password</code> header. Paste it here to have the frontend inject it automatically.
          Backend currently reports auth: <strong>{health?.auth ?? '—'}</strong>.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="password"
            value={passwordDraft}
            onChange={(e) => setPasswordDraft(e.target.value)}
            placeholder="Shared secret"
            className="flex-1 min-w-[200px] text-base border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg px-3 py-2"
          />
          <button
            type="button"
            onClick={savePassword}
            className="px-4 py-2 text-base bg-cyan-500 text-white rounded-lg hover:bg-cyan-600"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setPasswordDraft('');
              setStoredPassword('');
              addToast('Password cleared', 'info');
            }}
            className="px-4 py-2 text-base bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 rounded-lg hover:bg-stone-200 dark:hover:bg-stone-700"
          >
            Clear
          </button>
        </div>
      </section>

      {/* Sync history */}
      <section className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6 space-y-3">
        <h2 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">Recent sync runs</h2>
        {loading && history.length === 0 ? (
          <Skeleton className="h-24 w-full" />
        ) : history.length === 0 ? (
          <p className="text-base text-stone-500 dark:text-stone-400">No sync runs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto border border-stone-200 dark:border-stone-800 rounded-lg">
            <table className="min-w-full text-base">
              <thead className="bg-stone-50 dark:bg-stone-800">
                <tr>
                  <th className="px-3 py-2 text-left text-stone-500 dark:text-stone-400">Started</th>
                  <th className="px-3 py-2 text-left text-stone-500 dark:text-stone-400">Status</th>
                  <th className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">Success</th>
                  <th className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">Fail</th>
                  <th className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">Duration</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-stone-100 dark:border-stone-800">
                    <td className="px-3 py-2 text-stone-600 dark:text-stone-300">{h.started_at}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex text-xs px-2 py-0.5 rounded-full ${
                        h.status === 'success'
                          ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                      }`}>
                        {h.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{h.success_count ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-rose-600 dark:text-rose-400">{h.fail_count ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-stone-600 dark:text-stone-300">
                      {h.duration_seconds != null ? `${Math.round(h.duration_seconds)}s` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
};

interface ProviderRowProps {
  name: string;
  label: string;
  envKey: string;
  configured: boolean;
  onSaved: (ok: boolean, provider: string) => void;
}

const ProviderRow = ({ name, label, envKey, configured, onSaved }: ProviderRowProps) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: name, value }),
      });
      const ok = res.ok;
      onSaved(ok, name);
      if (ok) {
        setValue('');
        setEditing(false);
      }
    } catch {
      onSaved(false, name);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-3 py-2 bg-stone-50 dark:bg-stone-800 rounded space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base text-stone-800 dark:text-stone-100 truncate">{label}</p>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            <code className="text-xs px-1 py-0.5 bg-stone-200 dark:bg-stone-700 rounded">{envKey}</code>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {configured ? (
            <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-300">
              <CheckCircle className="w-3.5 h-3.5" /> configured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400">
              <XCircle className="w-3.5 h-3.5" /> missing
            </span>
          )}
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="inline-flex items-center gap-1 text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
          >
            <Key className="w-3.5 h-3.5" />
            {editing ? 'Cancel' : configured ? 'Replace' : 'Set key'}
          </button>
        </div>
      </div>
      {editing && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <input
              type={reveal ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`Paste ${envKey}…`}
              autoFocus
              className="w-full text-base border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 rounded-lg pl-3 pr-9 py-2 font-mono"
            />
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-200"
              aria-label={reveal ? 'Hide key' : 'Show key'}
            >
              {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving || !value.trim()}
            className="inline-flex items-center gap-1 px-3 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 disabled:opacity-50 text-base"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save
          </button>
          {configured && (
            <button
              type="button"
              onClick={() => {
                setValue('');
                save();
              }}
              disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-2 bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 rounded-lg hover:bg-stone-200 dark:hover:bg-stone-700 disabled:opacity-50 text-base"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// TelegramBriefPanel — preview + send the daily brief via the Telegram bot
// configured in .env (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID).  Composes a
// one-message survival summary (cash, net/mo, runway, unresolved advisor
// items, top recommendation) and lets the user preview or fire-once.
//
// A future iteration will add a scheduled-send option; this panel is the
// manual preview/send first step.
// ============================================================================
interface BriefPreview {
  text: string;
  fields: Record<string, unknown>;
  as_of: string;
}

const TelegramBriefPanel = () => {
  const [preview, setPreview] = useState<BriefPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadPreview = async (force = false) => {
    setLoading(true); setErr(null); setStatus(null);
    try {
      const res = await fetch(`/api/intel/telegram-brief/preview${force ? '?force=true' : ''}`);
      if (!res.ok) throw new Error(`preview ${res.status}`);
      setPreview(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load preview');
    } finally { setLoading(false); }
  };

  const send = async () => {
    setSending(true); setErr(null); setStatus(null);
    try {
      const res = await fetch('/api/intel/telegram-brief/send', { method: 'POST' });
      const j = await res.json();
      if (j.delivered) {
        setStatus({ ok: true, msg: `Sent to Telegram · message id ${j.message_id}` });
        if (j.brief) setPreview(j.brief);
      } else {
        setStatus({ ok: false, msg: j.error || 'Telegram rejected the message' });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Send failed');
    } finally { setSending(false); }
  };

  useEffect(() => { loadPreview(); }, []);

  return (
    <section className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-cyan-500" />
          <h2 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">Daily Telegram brief</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadPreview(true)}
            disabled={loading}
            className="text-xs font-mono uppercase tracking-wider text-cyan-500 dark:text-cyan-400 hover:text-cyan-600 inline-flex items-center gap-1 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh preview
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || !preview}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg text-base disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending ? 'Sending' : 'Send now'}
          </button>
        </div>
      </div>

      <p className="text-base text-stone-500 dark:text-stone-400 leading-relaxed">
        One-message daily summary (cash, net/mo, unresolved advisor items, top recommendation) sent to the Telegram chat configured in <code className="text-xs px-1 py-0.5 bg-stone-100 dark:bg-stone-800 rounded">TELEGRAM_CHAT_ID</code>. The compose is intentionally terse so it reads at a glance on your phone. Runs on-demand today; scheduled auto-send is a future iteration.
      </p>

      {err && <ErrorState title="Brief unavailable" message={err} onRetry={() => loadPreview(true)} />}

      {preview && (
        <div className="border border-stone-200 dark:border-stone-800 rounded-lg p-4 bg-stone-50 dark:bg-stone-950/50">
          <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-2">Preview</div>
          <pre className="text-sm text-stone-900 dark:text-stone-100 whitespace-pre-wrap font-mono leading-relaxed">{preview.text}</pre>
        </div>
      )}

      {status && (
        <div className={`text-xs font-mono uppercase tracking-wider ${status.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {status.ok ? <CheckCircle className="inline w-3 h-3 mr-1" /> : <XCircle className="inline w-3 h-3 mr-1" />}
          {status.msg}
        </div>
      )}
    </section>
  );
};

export default Settings;
