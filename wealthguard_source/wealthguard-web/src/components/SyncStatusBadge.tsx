import { useEffect, useState } from 'react';
import { CheckCircle, AlertTriangle, XCircle, Loader2 } from 'lucide-react';

interface SyncRun {
  started_at?: string;
  completed_at?: string;
  status?: string;
  holdings_count?: number;
  success_count?: number;
  fail_count?: number;
  duration_seconds?: number;
  details?: string;
}

interface HealthResponse {
  api: string;
  database: 'ok' | { error: string } | string;
  last_sync: SyncRun | null;
  providers: Record<string, 'configured' | 'missing'>;
  whisper?: string;
  auth?: string;
  checked_at: string;
}

type Tone = 'green' | 'amber' | 'red' | 'loading';

const POLL_MS = 60_000;

function minutesSince(iso?: string): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 60000;
}

const SyncStatusBadge = () => {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const json: HealthResponse = await res.json();
        if (!cancelled) {
          setData(json);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'health check failed');
      }
    };
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  let tone: Tone = 'loading';
  let Icon = Loader2;
  let label = 'Checking…';
  let title = 'Checking backend health';

  if (err) {
    tone = 'red';
    Icon = XCircle;
    label = 'Offline';
    title = `Health check failed: ${err}`;
  } else if (data) {
    const dbOk = data.database === 'ok';
    const sync = data.last_sync;
    const ageMin = minutesSince(sync?.started_at);
    if (!dbOk) {
      tone = 'red';
      Icon = XCircle;
      label = 'DB error';
      title = typeof data.database === 'object' && 'error' in data.database
        ? `Database: ${(data.database as { error: string }).error}`
        : 'Database unreachable';
    } else if (sync?.status === 'failed') {
      tone = 'red';
      Icon = XCircle;
      label = 'Sync failed';
      title = `Sync failed ${sync.started_at ?? ''} · ${sync.fail_count ?? 0} failures`;
    } else if (!sync || ageMin > 30) {
      tone = 'amber';
      Icon = AlertTriangle;
      label = sync ? `${Math.round(ageMin)}m old` : 'No sync yet';
      title = sync
        ? `Last sync started ${sync.started_at} (${Math.round(ageMin)} min ago)`
        : 'No sync has run yet';
    } else {
      tone = 'green';
      Icon = CheckCircle;
      label = 'Healthy';
      title = `Last sync: ${sync.status ?? 'ok'} · ${Math.round(ageMin)} min ago`;
    }
  }

  const toneClasses: Record<Tone, string> = {
    loading: 'text-stone-500 bg-stone-100 dark:bg-stone-800 dark:text-stone-300',
    green: 'text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-300',
    amber: 'text-cyan-700 bg-cyan-50 dark:bg-cyan-800/30 dark:text-cyan-200',
    red: 'text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-300',
  };

  return (
    <span
      title={title}
      className={`hidden md:inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${toneClasses[tone]}`}
    >
      <Icon className={`w-3.5 h-3.5 ${tone === 'loading' ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
};

export default SyncStatusBadge;
