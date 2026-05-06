import { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle, XCircle, AlertCircle, Clock, TrendingUp } from 'lucide-react';

interface SyncRun {
  id: number;
  started_at: string;
  completed_at: string;
  status: string;
  holdings_count: number;
  success_count: number;
  fail_count: number;
  duration_seconds: number;
  details: {
    sources: Record<string, number>;
    crypto_count: number;
    stock_count: number;
  };
}

export function SyncDashboard() {
  const [status, setStatus] = useState<SyncRun | null>(null);
  const [history, setHistory] = useState<SyncRun[]>([]);
  const [triggering, setTriggering] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/sync/status');
      if (res.ok) setStatus(await res.json());
      
      const histRes = await fetch('/api/sync/history?limit=5');
      if (histRes.ok) setHistory(await histRes.json());
    } catch (e) {
      console.error('Failed to fetch sync status:', e);
    }
  };

  const triggerSync = async () => {
    setTriggering(true);
    try {
      const res = await fetch('/api/sync/trigger', { method: 'POST' });
      const result = await res.json();
      console.log('Sync triggered:', result);
      // Wait a bit then refresh
      setTimeout(fetchStatus, 2000);
    } catch (e) {
      console.error('Failed to trigger sync:', e);
    } finally {
      setTimeout(() => setTriggering(false), 3000);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'partial': return <AlertCircle className="w-5 h-5 text-cyan-500" />;
      default: return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const formatTime = (iso: string) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="bg-white dark:bg-stone-900 dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-cyan-500" />
          <h2 className="text-xl font-bold">Price Sync Status</h2>
        </div>
        <button
          onClick={triggerSync}
          disabled={triggering}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-500 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${triggering ? 'animate-spin' : ''}`} />
          {triggering ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {status ? (
        <div className="space-y-4">
          {/* Current Status */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
              <div className="text-base text-gray-500">Status</div>
              <div className="flex items-center gap-2 mt-1">
                {getStatusIcon(status.status)}
                <span className="font-semibold capitalize">{status.status}</span>
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
              <div className="text-base text-gray-500">Success Rate</div>
              <div className="text-2xl font-bold mt-1">
                {Math.round((status.success_count / status.holdings_count) * 100)}%
              </div>
              <div className="text-xs text-gray-400">
                {status.success_count}/{status.holdings_count} holdings
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
              <div className="text-base text-gray-500">Duration</div>
              <div className="text-2xl font-bold mt-1">
                {status.duration_seconds?.toFixed(1)}s
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
              <div className="text-base text-gray-500">Last Sync</div>
              <div className="font-semibold mt-1">
                {formatTime(status.completed_at || status.started_at)}
              </div>
            </div>
          </div>

          {/* Source Breakdown */}
          {status.details?.sources && (
            <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
              <div className="text-base text-gray-500 mb-2">Data Sources</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(status.details.sources).map(([source, count]) => (
                  <span
                    key={source}
                    className="px-3 py-1 bg-cyan-100 dark:bg-cyan-800 text-cyan-600 dark:text-cyan-300 rounded-full text-base"
                  >
                    {source}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400">
          No sync data available yet
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="mt-6">
          <h3 className="text-base font-semibold text-gray-500 mb-3">Recent Syncs</h3>
          <div className="space-y-2">
            {history.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-base"
              >
                <div className="flex items-center gap-3">
                  {getStatusIcon(run.status)}
                  <span>#{run.id}</span>
                  <span className="text-gray-400">
                    {formatTime(run.completed_at || run.started_at)}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={run.fail_count > 0 ? 'text-cyan-500' : 'text-emerald-600 dark:text-emerald-400'}>
                    {run.success_count}/{run.holdings_count} OK
                  </span>
                  <span className="text-gray-400">{run.duration_seconds?.toFixed(1)}s</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
