import { useEffect, useRef, useState } from 'react';
import { Bell, X, Plus, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '../hooks/usePersistentState';

type AlertType = 'percent_change' | 'threshold_high' | 'threshold_low';

interface AlertConfig {
  id: number;
  symbol: string;
  alert_type: AlertType | string;
  threshold_value: number;
  is_active: number | boolean;
  created_at: string;
}

interface Props {
  symbol: string;
  assetName?: string;
  addToast?: ReturnType<typeof useToast>['addToast'];
}

const labelForType = (t: string) =>
  t === 'threshold_high' ? 'Price above'
    : t === 'threshold_low' ? 'Price below'
    : 'Change by ±%';

const AlertDialog = ({ symbol, assetName, addToast: externalToast }: Props) => {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alertType, setAlertType] = useState<AlertType>('threshold_high');
  const [threshold, setThreshold] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const localToast = useToast();
  const toast = externalToast ?? localToast.addToast;

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/alerts/config?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      setAlerts(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, symbol]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const save = async () => {
    const value = parseFloat(threshold);
    if (!Number.isFinite(value)) {
      toast('Enter a number', 'warning');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/alerts/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, alert_type: alertType, threshold_value: value, is_active: true }),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      toast('Alert created', 'success');
      setThreshold('');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      const res = await fetch(`/api/alerts/config/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      toast('Alert deleted', 'info');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error');
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 dark:text-stone-500 hover:text-cyan-500 dark:hover:text-cyan-400"
        title={`Alerts for ${symbol}`}
      >
        <Bell className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Alerts for ${symbol}`}
          className="absolute right-0 z-30 mt-2 w-80 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg shadow-xl"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 dark:border-stone-800">
            <div className="min-w-0">
              <p className="text-base font-semibold text-stone-800 dark:text-stone-100 truncate">
                {assetName || symbol} alerts
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400">Sent via Telegram</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800"
              aria-label="Close alerts"
            >
              <X className="w-4 h-4 text-stone-500 dark:text-stone-400" />
            </button>
          </div>

          <div className="p-4 space-y-3">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <select
                value={alertType}
                onChange={(e) => setAlertType(e.target.value as AlertType)}
                className="text-base border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg px-2 py-1"
              >
                <option value="threshold_high">Price above</option>
                <option value="threshold_low">Price below</option>
                <option value="percent_change">Change by ±%</option>
              </select>
              <input
                type="number"
                inputMode="decimal"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder={alertType === 'percent_change' ? '5' : '0.00'}
                className="w-24 text-base border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg px-2 py-1"
              />
            </div>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 disabled:opacity-50 text-base"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create alert
            </button>
          </div>

          <div className="border-t border-stone-100 dark:border-stone-800 max-h-56 overflow-y-auto">
            {loading && alerts.length === 0 ? (
              <div className="p-4 flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
              </div>
            ) : error ? (
              <div className="p-4 text-xs text-rose-600 dark:text-rose-400">{error}</div>
            ) : alerts.length === 0 ? (
              <div className="p-4 text-xs text-stone-500 dark:text-stone-400 text-center">
                No alerts set.
              </div>
            ) : (
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {alerts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between px-4 py-2 text-base">
                    <div className="min-w-0">
                      <p className="text-stone-800 dark:text-stone-100">
                        {labelForType(a.alert_type)} <strong>{a.threshold_value}</strong>
                      </p>
                      <p className="text-xs text-stone-500 dark:text-stone-400">
                        created {new Date(a.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(a.id)}
                      className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AlertDialog;
