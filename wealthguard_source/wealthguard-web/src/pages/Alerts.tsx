import { useState, useEffect } from 'react';
import { Bell, AlertTriangle, TrendingUp, TrendingDown, RefreshCw, CheckCircle } from 'lucide-react';

interface PriceAlert {
  id: number;
  symbol: string;
  alert_type: string;
  current_price: number;
  previous_price: number;
  change_percent: number;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  sent_at: string;
  acknowledged: boolean;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/alerts?hours=24');
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch (e) {
      console.error('Error fetching alerts:', e);
    }
    setLoading(false);
  };

  const triggerAlertCheck = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/alerts/check', { method: 'POST' });
      const result = await res.json();
      console.log('Alert check result:', result);
      fetchAlerts(); // Refresh
    } catch (e) {
      console.error('Error checking alerts:', e);
    }
    setChecking(false);
  };

  const sendTestAlert = async () => {
    setSendingTest(true);
    try {
      const res = await fetch('/api/alerts/test', { method: 'POST' });
      const result = await res.json();
      console.log('Test alert result:', result);
      fetchAlerts(); // Refresh
    } catch (e) {
      console.error('Error sending test alert:', e);
    }
    setSendingTest(false);
  };

  useEffect(() => {
    fetchAlerts();
    // Refresh every 5 minutes
    const interval = setInterval(fetchAlerts, 300000);
    return () => clearInterval(interval);
  }, []);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800';
      case 'warning': return 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800';
      case 'info': return 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800';
      default: return 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700';
    }
  };

  const getAlertIcon = (changePercent: number, severity: string) => {
    if (severity === 'critical') return <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />;
    if (changePercent > 0) return <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />;
    return <TrendingDown className="w-5 h-5 text-rose-600 dark:text-rose-400" />;
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
  };

  const unacknowledged = alerts.filter(a => !a.acknowledged);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl text-stone-900 dark:text-stone-50 flex items-center gap-3">
            <Bell className="w-8 h-8 text-stone-700 dark:text-stone-300" />
            Price Alerts
          </h1>
          <p className="mt-1 text-stone-500 dark:text-stone-400">
            Monitor portfolio movements and get notified of significant changes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={sendTestAlert}
            disabled={sendingTest}
            className="flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-700 dark:text-stone-300 rounded-lg hover:bg-stone-200 disabled:opacity-50"
          >
            <Bell className="w-4 h-4" />
            Test Alert
          </button>
          <button
            onClick={triggerAlertCheck}
            disabled={checking}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-500 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            Check Now
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white dark:bg-stone-900 p-4 rounded-lg shadow border border-stone-200 dark:border-stone-800">
          <div className="text-base text-stone-500 dark:text-stone-400">Total Alerts (24h)</div>
          <div className="text-2xl font-bold text-stone-800 dark:text-stone-100">{alerts.length}</div>
        </div>
        <div className="bg-white dark:bg-stone-900 p-4 rounded-lg shadow border border-stone-200 dark:border-stone-800">
          <div className="text-base text-stone-500 dark:text-stone-400">Unacknowledged</div>
          <div className="text-2xl font-bold text-cyan-500">{unacknowledged.length}</div>
        </div>
        <div className="bg-white dark:bg-stone-900 p-4 rounded-lg shadow border border-stone-200 dark:border-stone-800">
          <div className="text-base text-stone-500 dark:text-stone-400">Critical</div>
          <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">
            {alerts.filter(a => a.severity === 'critical').length}
          </div>
        </div>
      </div>

      {/* Alert Thresholds Info */}
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 border-l-cyan-500 rounded-lg p-4">
        <h3 className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-2">Alert Thresholds</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-base text-stone-700 dark:text-stone-300">
          <div>📉 Portfolio drop: <strong className="text-stone-900 dark:text-stone-100">5%</strong></div>
          <div>📈 Portfolio gain: <strong className="text-stone-900 dark:text-stone-100">10%</strong></div>
          <div>📉 Holding drop: <strong className="text-stone-900 dark:text-stone-100">8%</strong></div>
          <div>📈 Holding gain: <strong className="text-stone-900 dark:text-stone-100">15%</strong></div>
          <div>🔄 Crypto volatility: <strong className="text-stone-900 dark:text-stone-100">12%</strong></div>
          <div>⏱️ Rate limit: <strong className="text-stone-900 dark:text-stone-100">3/day per symbol</strong></div>
        </div>
      </div>

      {/* Alerts List */}
      <div className="bg-white dark:bg-stone-900 rounded-lg shadow border border-stone-200 dark:border-stone-800">
        <div className="p-4 border-b border-stone-200 dark:border-stone-800">
          <h2 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">Recent Alerts</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-stone-400">
            <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin" />
            Loading alerts...
          </div>
        ) : alerts.length === 0 ? (
          <div className="p-8 text-center text-stone-400 dark:text-stone-500">
            <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
            <p>No alerts in the last 24 hours</p>
            <p className="text-base mt-1">Portfolio is stable</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-4 hover:bg-stone-50 dark:bg-stone-800 dark:hover:bg-stone-800 transition-colors ${
                  !alert.acknowledged ? 'bg-cyan-50/50' : ''
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="mt-1">
                    {getAlertIcon(alert.change_percent, alert.severity)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-stone-800 dark:text-stone-100">{alert.symbol}</span>
                      <span className={`px-2 py-0.5 text-xs rounded-full border ${getSeverityColor(alert.severity)}`}>
                        {alert.severity}
                      </span>
                      {!alert.acknowledged && (
                        <span className="px-2 py-0.5 text-xs bg-cyan-100 text-cyan-700 rounded-full">
                          New
                        </span>
                      )}
                    </div>
                    <p className="text-stone-700 dark:text-stone-200">{alert.message}</p>
                    <div className="flex items-center gap-4 mt-2 text-base text-stone-500 dark:text-stone-400">
                      <span>Current: ${alert.current_price?.toLocaleString()}</span>
                      <span className={alert.change_percent > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                        {alert.change_percent > 0 ? '+' : ''}{alert.change_percent?.toFixed(1)}%
                      </span>
                      <span>{formatTime(alert.sent_at)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Integration Info */}
      <div className="bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-800 rounded-lg p-4">
        <h3 className="font-semibold text-stone-700 dark:text-stone-200 mb-2">Telegram Integration</h3>
        <p className="text-base text-stone-600 dark:text-stone-400">
          Alerts are automatically sent to your configured Telegram chat.
          Check your phone for real-time notifications.
        </p>
      </div>
    </div>
  );
}
