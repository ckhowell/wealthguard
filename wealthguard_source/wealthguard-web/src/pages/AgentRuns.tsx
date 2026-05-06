import { useEffect, useState } from 'react';
import {
  Bot, Play, RefreshCw, AlertTriangle, CheckCircle2, Clock,
  ChevronRight, Loader2,
} from 'lucide-react';
import Skeleton from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import ToastContainer from '../components/ToastContainer';
import { useToast } from '../hooks/usePersistentState';

interface AgentInfo {
  name: string;
  description: string;
  model: string;
  last_run: {
    id: number;
    severity: string | null;
    status: string | null;
    started_at: string;
  } | null;
}

interface Run {
  id: number;
  agent_name: string;
  severity: string | null;
  status: string | null;
  duration_seconds: number | null;
  output_excerpt: string | null;
  started_at: string;
  completed_at: string | null;
}

const severityColor = (s: string | null | undefined) => {
  switch (s) {
    case 'red': return 'text-rose-600 bg-rose-50 dark:bg-rose-900/30 border-rose-200 dark:border-rose-800';
    case 'amber': return 'text-yellow-700 bg-yellow-50 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800';
    case 'green': return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800';
    default: return 'text-stone-600 bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700';
  }
};

const statusIcon = (status: string | null) => {
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-500" />;
  if (status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
  if (status === 'failed') return <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />;
  return <Clock className="w-3.5 h-3.5 text-stone-400" />;
};

const fmtRelative = (ts: string | null | undefined) => {
  if (!ts) return '—';
  const d = new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const AgentRuns = () => {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string>('');
  const { toasts, addToast, removeToast } = useToast();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [aRes, rRes] = await Promise.all([
        fetch('/api/harness/agents'),
        fetch(selectedAgent ? `/api/harness/runs?agent=${selectedAgent}&limit=60` : '/api/harness/runs?limit=60'),
      ]);
      if (!aRes.ok) throw new Error('Failed to load agents');
      setAgents(await aRes.json());
      setRuns(rRes.ok ? await rRes.json() : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [selectedAgent]);

  // Poll every 30s so running agents update in place.
  useEffect(() => {
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgent]);

  const trigger = async (agent: string) => {
    setTriggering(agent);
    try {
      const res = await fetch(`/api/harness/trigger/${agent}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Trigger failed (${res.status})`);
      addToast(`${agent} started`, 'success');
      setTimeout(load, 1500);
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Trigger failed', 'error');
    } finally {
      setTriggering('');
    }
  };

  if (loading && agents.length === 0) return <div className="p-6"><Skeleton /></div>;
  if (error) return <div className="p-6"><ErrorState message={error} /></div>;

  const redCount = runs.filter(r => r.severity === 'red').length;
  const amberCount = runs.filter(r => r.severity === 'amber').length;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl text-stone-900 dark:text-stone-50 flex items-center gap-3">
            <Bot className="w-6 h-6 text-cyan-500" /> Agent Harness
          </h1>
          <p className="text-base text-stone-500 dark:text-stone-400">
            {agents.length} agents · {runs.length} recent runs
            {redCount > 0 && <span className="ml-2 text-rose-600 ">· {redCount} red</span>}
            {amberCount > 0 && <span className="ml-2 text-yellow-600 dark:text-yellow-400 ">· {amberCount} amber</span>}
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-1.5 border border-stone-200 dark:border-stone-700 rounded-lg text-base hover:bg-stone-100 dark:hover:bg-stone-800 inline-flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Agent cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {agents.map(a => {
          const sev = a.last_run?.severity;
          const highlight = sev === 'red' || sev === 'amber';
          return (
            <div
              key={a.name}
              className={`rounded-lg border p-4 cursor-pointer transition-colors ${
                selectedAgent === a.name
                  ? 'bg-cyan-50 dark:bg-cyan-800/20 border-cyan-300 dark:border-cyan-600'
                  : highlight
                    ? severityColor(sev)
                    : 'bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700'
              }`}
              onClick={() => setSelectedAgent(prev => prev === a.name ? '' : a.name)}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                  <h3 className="text-stone-800 dark:text-stone-100">{a.name}</h3>
                  <span className="text-xs uppercase px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">{a.model}</span>
                </div>
                {sev && (
                  <span className={`text-xs uppercase px-1.5 py-0.5 rounded ${severityColor(sev)}`}>{sev}</span>
                )}
              </div>
              <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2 mb-3">{a.description}</p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-stone-500 dark:text-stone-400 flex items-center gap-1">
                  {statusIcon(a.last_run?.status || null)}
                  {a.last_run ? fmtRelative(a.last_run.started_at) : 'Never run'}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); trigger(a.name); }}
                  disabled={triggering === a.name}
                  className="px-2 py-1 text-xs bg-cyan-500 hover:bg-cyan-600 text-white rounded inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {triggering === a.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  Run
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Run list + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Run list */}
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
            <h3 className="text-stone-800 dark:text-stone-100">
              Recent runs {selectedAgent && <span className="text-xs font-normal text-cyan-500">· {selectedAgent}</span>}
            </h3>
            {selectedAgent && (
              <button onClick={() => setSelectedAgent('')} className="text-xs text-cyan-500 hover:underline">Clear</button>
            )}
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {runs.length === 0 ? (
              <div className="p-6 text-center text-base text-stone-500 dark:text-stone-400">No runs yet. Kick one off with the Run button on an agent.</div>
            ) : runs.map(r => (
              <div
                key={r.id}
                onClick={() => setSelectedRun(r)}
                className={`px-4 py-3 border-b border-stone-100 dark:border-stone-800 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/50 ${selectedRun?.id === r.id ? 'bg-cyan-50 dark:bg-cyan-800/20' : ''}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-base text-stone-800 dark:text-stone-100">{r.agent_name}</span>
                  <span className={`text-xs uppercase px-1.5 py-0.5 rounded ${severityColor(r.severity)}`}>{r.severity || 'info'}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                  {statusIcon(r.status)}
                  <span>{fmtRelative(r.started_at)}</span>
                  {r.duration_seconds != null && <span>· {r.duration_seconds.toFixed(1)}s</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Run detail */}
        <div className="lg:col-span-2">
          {selectedRun ? (
            <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 overflow-hidden">
              <div className="px-5 py-3 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
                <div>
                  <h3 className="text-stone-800 dark:text-stone-100">
                    {selectedRun.agent_name}
                    <span className={`ml-2 text-xs uppercase px-1.5 py-0.5 rounded ${severityColor(selectedRun.severity)}`}>
                      {selectedRun.severity || 'info'}
                    </span>
                  </h3>
                  <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                    Started {fmtRelative(selectedRun.started_at)}
                    {selectedRun.duration_seconds != null && ` · ${selectedRun.duration_seconds.toFixed(1)}s`}
                  </p>
                </div>
                <button onClick={() => setSelectedRun(null)} className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300">Close</button>
              </div>
              <pre className="p-5 text-xs text-stone-700 dark:text-stone-300 whitespace-pre-wrap max-h-[600px] overflow-y-auto font-mono leading-relaxed">
                {selectedRun.output_excerpt || '(no output)'}
              </pre>
            </div>
          ) : (
            <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-10 text-center text-stone-500 dark:text-stone-400">
              <ChevronRight className="w-6 h-6 text-stone-300 dark:text-stone-700 mx-auto mb-2" />
              Select a run on the left to see its output.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentRuns;
