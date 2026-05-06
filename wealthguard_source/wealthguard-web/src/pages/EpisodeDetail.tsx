import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Clock, ExternalLink, Sparkles, Check, Star,
  Loader2, RefreshCw,
} from 'lucide-react';
import Skeleton from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import ToastContainer from '../components/ToastContainer';
import { useToast } from '../hooks/usePersistentState';

const API_BASE = '/api/podbits';

interface Episode {
  id: number;
  source_id: number;
  title: string;
  description?: string;
  url: string;
  published_at?: string;
  transcript?: string;
  summary?: string;
  ai_analysis?: string | null;
  ai_analysis_at?: string | null;
  duration_seconds?: number;
  is_listened?: number | boolean;
  user_rating?: number | null;
  user_notes?: string | null;
  source_name?: string;
}

interface AISummary {
  brief_summary?: string;
  key_points?: string[];
  people_mentioned?: string[];
  companies_tickers?: string[];
  notable_quotes?: string[];
  action_items?: string[];
  tickers?: string[];
}

interface PodTake {
  pod_take_idx: number;
  stance: string;
  confidence: string;
  ai_take: string;
  tickers?: string[];
  portfolio_impact?: string | null;
}

interface AiAnalysis {
  episode_take?: string;
  pod_takes?: PodTake[];
  method?: string;
  generated_at?: string;
}

const STANCE_STYLE: Record<string, { label: string; cls: string; accent: string }> = {
  agrees:    { label: 'Agrees',    cls: 'text-green-700 dark:text-green-300  bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',       accent: 'border-l-green-500' },
  disagrees: { label: 'Disagrees', cls: 'text-red-700 dark:text-red-300      bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',             accent: 'border-l-red-500' },
  context:   { label: 'Context',   cls: 'text-stone-700 dark:text-stone-300  bg-stone-50 dark:bg-stone-900/40 border-stone-200 dark:border-stone-800',     accent: 'border-l-stone-500' },
  caution:   { label: 'Caution',   cls: 'text-cyan-600 dark:text-cyan-300  bg-cyan-50 dark:bg-cyan-800/20 border-cyan-200 dark:border-cyan-700',    accent: 'border-l-cyan-500' },
};

function parseJSON<T>(raw?: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function daysAgo(iso?: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const days = Math.round((Date.now() - t) / (24 * 3600 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

function formatDuration(seconds?: number) {
  if (!seconds) return null;
  const mins = Math.floor(seconds / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  return `${mins}m`;
}

const EpisodeDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toasts, addToast, removeToast } = useToast();

  const [episode, setEpisode] = useState<Episode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const summary = useMemo(() => parseJSON<AISummary>(episode?.summary), [episode?.summary]);
  const analysis = useMemo(() => parseJSON<AiAnalysis>(episode?.ai_analysis ?? null), [episode?.ai_analysis]);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/episodes/${id}`);
      if (!res.ok) throw new Error(`Episode ${id} not found`);
      const data = await res.json();
      setEpisode(data?.episode ?? data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const patch = async (body: Record<string, unknown>) => {
    if (!episode) return;
    try {
      const res = await fetch(`${API_BASE}/episodes/${episode.id}/engagement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setEpisode({ ...episode, ...(await res.json()) });
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Save failed', 'error');
    }
  };

  const runAnalyst = async () => {
    if (!episode) return;
    setAnalyzing(true);
    try {
      const res = await fetch(`${API_BASE}/episodes/${episode.id}/analyze?force=true`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      await load();
      addToast('WG Analyst refreshed', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Analyst failed', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !episode) {
    return (
      <div className="max-w-3xl mx-auto">
        <button
          type="button"
          onClick={() => navigate('/podbits')}
          className="inline-flex items-center gap-1.5 text-base text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to PodBits
        </button>
        <ErrorState title="Couldn't load episode" message={error ?? 'Not found'} onRetry={load} />
      </div>
    );
  }

  const duration = formatDuration(episode.duration_seconds);
  const keyPoints = summary?.key_points ?? [];
  const takesByIdx = new Map<number, PodTake>();
  (analysis?.pod_takes ?? []).forEach((t) => takesByIdx.set(t.pod_take_idx, t));

  return (
    <div className="max-w-3xl mx-auto pb-24">
      {/* Breadcrumb / back */}
      <button
        type="button"
        onClick={() => navigate('/podbits')}
        className="inline-flex items-center gap-1.5 text-base text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 mb-6"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> PodBits
      </button>

      {/* Title block */}
      <header className="mb-10">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">
          <span className="text-stone-800 dark:text-stone-200">{episode.source_name}</span>
          <span>·</span>
          <span>{daysAgo(episode.published_at)}</span>
          {duration && (<><span>·</span><span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{duration}</span></>)}
        </div>
        <h1 className="text-3xl sm:text-4xl text-stone-900 dark:text-stone-50">
          {episode.title}
        </h1>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => patch({ is_listened: !episode.is_listened })}
            className={`inline-flex items-center gap-1.5 text-base px-3 py-1.5 rounded-md transition ${
              episode.is_listened
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-700'
            }`}
          >
            <Check className="w-4 h-4" />
            {episode.is_listened ? 'Listened' : 'Mark listened'}
          </button>
          <div className="inline-flex items-center gap-0.5 px-1 rounded-md bg-stone-100 dark:bg-stone-800">
            {[1,2,3,4,5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => patch({ user_rating: n })}
                title={`Rate ${n}/5`}
                className="p-1 rounded hover:bg-stone-200 dark:hover:bg-stone-700"
              >
                <Star className={`w-4 h-4 ${(episode.user_rating ?? 0) >= n ? 'text-cyan-400 fill-cyan-400' : 'text-stone-400 dark:text-stone-600'}`} />
              </button>
            ))}
          </div>
          <a
            href={episode.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-base px-3 py-1.5 rounded-md bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-700"
          >
            <ExternalLink className="w-4 h-4" />
            Listen
          </a>
          <button
            type="button"
            onClick={runAnalyst}
            disabled={analyzing}
            className="ml-auto inline-flex items-center gap-1.5 text-base px-3 py-1.5 rounded-md border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-50"
          >
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh analyst
          </button>
        </div>
      </header>

      {/* WG Analyst hero — lead takeaway */}
      {analysis?.episode_take && (
        <section className="mb-10 border-l-4 border-cyan-500 pl-5 sm:pl-6 py-1">
          <div className="flex items-center gap-2 text-xs font-mono uppercase text-cyan-600 dark:text-cyan-400 mb-2">
            <Sparkles className="w-3 h-3" />
            WG Analyst
            {analysis.method && <span className="text-stone-400">· {analysis.method}</span>}
            {analysis.generated_at && <span className="text-stone-400">· {daysAgo(analysis.generated_at)}</span>}
          </div>
          <p className="text-xl text-stone-900 dark:text-stone-50">
            {analysis.episode_take}
          </p>
        </section>
      )}

      {/* Brief summary */}
      {summary?.brief_summary && (
        <section className="mb-10">
          <h2 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">Episode brief</h2>
          <p className="text-base text-stone-800 dark:text-stone-200">
            {summary.brief_summary}
          </p>
        </section>
      )}

      {/* Key points paired with analyst takes — the core of the page */}
      {keyPoints.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-4">
            Key claims + WG Analyst response
          </h2>
          <ol className="space-y-6">
            {keyPoints.map((kp, i) => {
              const t = takesByIdx.get(i);
              const style = t ? (STANCE_STYLE[(t.stance || '').toLowerCase()] ?? STANCE_STYLE.context) : null;
              return (
                <li key={i} className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2">
                  <span className="pt-1 text-xs font-mono text-stone-400 dark:text-stone-500 tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="space-y-3">
                    <p className="text-base text-stone-800 dark:text-stone-100">
                      {kp}
                    </p>
                    {t && style && (
                      <div className={`border-l-4 ${style.accent} pl-4 py-0.5`}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`text-xs uppercase font-semibold px-1.5 py-0.5 rounded border ${style.cls}`}>
                            {style.label}
                          </span>
                          <span className="text-xs text-stone-500 dark:text-stone-400 uppercase tracking-wider">
                            {t.confidence} confidence
                          </span>
                        </div>
                        <p className="text-base text-stone-700 dark:text-stone-200">
                          {t.ai_take}
                        </p>
                        {t.portfolio_impact && (
                          <p className="mt-2 text-base text-stone-700 dark:text-stone-300 bg-white dark:bg-stone-900 border-l-2 border-l-emerald-500 px-3 py-2 rounded">
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">Portfolio:</span> {t.portfolio_impact}
                          </p>
                        )}
                        {(t.tickers ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {(t.tickers ?? []).filter((x) => /^[A-Z0-9.\-]{2,6}$/.test(x)).map((x) => (
                              <span key={x} className="px-1.5 py-0.5 rounded font-mono text-xs bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200">
                                {x}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* Tickers + people row */}
      {((summary?.tickers?.length ?? 0) > 0 || (summary?.companies_tickers?.length ?? 0) > 0 || (summary?.people_mentioned?.length ?? 0) > 0) && (
        <section className="mb-10 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {((summary?.tickers?.length ?? 0) > 0 || (summary?.companies_tickers?.length ?? 0) > 0) && (
            <div>
              <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-2">Tickers mentioned</h3>
              <div className="flex flex-wrap gap-1.5">
                {[...(summary?.tickers ?? []), ...(summary?.companies_tickers ?? [])]
                  .filter((t, i, a) => a.indexOf(t) === i && /^[A-Z0-9.\-]{2,6}$/.test(t))
                  .map((t) => (
                    <span key={t} className="px-2 py-0.5 text-xs font-mono rounded bg-cyan-50 dark:bg-cyan-800/30 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-700">
                      {t}
                    </span>
                  ))}
              </div>
            </div>
          )}
          {(summary?.people_mentioned?.length ?? 0) > 0 && (
            <div>
              <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-2">People</h3>
              <div className="flex flex-wrap gap-1.5">
                {summary!.people_mentioned!.map((p) => (
                  <span key={p} className="px-2 py-0.5 text-xs rounded bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Notable quotes */}
      {summary?.notable_quotes && summary.notable_quotes.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3">Notable quotes</h2>
          <ul className="space-y-3">
            {summary.notable_quotes.map((q, i) => (
              <li key={i} className="pl-4 border-l-2 border-stone-300 dark:border-stone-700 text-base text-stone-700 dark:text-stone-300 italic">
                &ldquo;{q}&rdquo;
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Your notes */}
      <section className="mb-10">
        <h2 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-2">Your notes</h2>
        <textarea
          defaultValue={episode.user_notes ?? ''}
          onBlur={(e) => patch({ user_notes: e.target.value })}
          placeholder="Takeaways, rebuttals, follow-ups…"
          rows={4}
          className="w-full text-base leading-relaxed border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-md px-4 py-3 focus:outline-none focus:ring-1 focus:ring-stone-400 dark:focus:ring-stone-600"
        />
      </section>

      {/* Description + transcript (collapsible) */}
      {episode.description && (
        <section className="mb-10">
          <h2 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-2">Episode description</h2>
          <p className="text-base text-stone-600 dark:text-stone-400 whitespace-pre-wrap">
            {episode.description}
          </p>
        </section>
      )}

      {episode.transcript && (
        <section>
          <button
            type="button"
            onClick={() => setTranscriptOpen((v) => !v)}
            className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200"
          >
            {transcriptOpen ? '– Hide' : '+ Show'} transcript ({episode.transcript.length.toLocaleString()} chars)
          </button>
          {transcriptOpen && (
            <div className="mt-3 bg-stone-50 dark:bg-stone-900 p-4 rounded-md text-base leading-relaxed text-stone-600 dark:text-stone-400 whitespace-pre-wrap max-h-[480px] overflow-y-auto">
              {episode.transcript}
            </div>
          )}
        </section>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
};

export default EpisodeDetail;
