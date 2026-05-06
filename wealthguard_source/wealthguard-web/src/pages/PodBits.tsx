import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Podcast, Search, Plus, Trash2, ExternalLink, RefreshCw, X,
  Clock, Play, Star, Check, Filter, Loader2, Sparkles,
} from 'lucide-react';
import Skeleton from '../components/Skeleton';
import ErrorState from '../components/ErrorState';
import ToastContainer from '../components/ToastContainer';
import { useToast } from '../hooks/usePersistentState';

// ============================================================================
// Types
// ============================================================================

type Kind = 'key_point' | 'quote' | 'action';

type Stance = 'agrees' | 'disagrees' | 'context' | 'caution';

interface Narrative {
  id: string;
  episode_id: number;
  episode_title: string;
  source_id: number;
  source_name: string;
  published_at?: string;
  url?: string;
  kind: Kind;
  text: string;
  people_mentioned: string[];
  companies_tickers: string[];
  sentiment?: string | null;
  llm_verified?: boolean;
  holdings_mentioned: string[];
  ai_take?: string | null;
  ai_stance?: Stance | string | null;
  ai_confidence?: string | null;
  ai_tickers?: string[];
  ai_portfolio_impact?: string | null;
  ai_method?: string | null;
}

interface Facets {
  sources: { id: number; name: string }[];
  people: { name: string; count: number }[];
  tickers: { ticker: string; count: number }[];
}

interface Source {
  id: number;
  name: string;
  source_type: 'podcast' | 'youtube';
  url: string;
  description?: string;
  is_active: boolean;
  last_checked_at?: string;
}

interface Episode {
  id: number;
  source_id: number;
  title: string;
  description?: string;
  url: string;
  published_at?: string;
  transcript?: string;
  summary?: string;
  duration_seconds?: number;
  is_processed: boolean;
  is_listened?: number | boolean;
  listened_at?: string | null;
  user_rating?: number | null;
  user_notes?: string | null;
  tags?: string[];
  source_name?: string;
}

interface AISummary {
  brief_summary?: string;
  full_summary?: string;
  key_points?: string[];
  people_mentioned?: string[];
  companies_tickers?: string[];
  notable_quotes?: string[];
  sentiment?: string;
  action_items?: string[];
  method?: string;
  description?: string;
}

type Tab = 'feed' | 'episodes' | 'sources';
type Sentiment = '' | 'bullish' | 'bearish' | 'neutral';

const API_BASE = '/api/podbits';

// ============================================================================
// Helpers
// ============================================================================

function parseSummary(raw?: string | null): AISummary | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function daysAgo(iso?: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const days = Math.round((Date.now() - t) / (24 * 3600 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function formatDuration(seconds?: number) {
  if (!seconds) return '—';
  const mins = Math.floor(seconds / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  return `${mins}m`;
}

const sentimentClasses: Record<string, string> = {
  bullish: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  bearish: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  neutral: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
};


// ============================================================================
// Feed card
// ============================================================================

interface FeedCardProps {
  narrative: Narrative;
  onOpen: (episodeId: number) => void;
}

const STANCE_STYLE: Record<string, { label: string; cls: string; dot: string }> = {
  agrees:    { label: 'Agrees',    cls: 'text-green-700 dark:text-green-300', dot: 'bg-green-500' },
  disagrees: { label: 'Disagrees', cls: 'text-red-700 dark:text-red-300',       dot: 'bg-red-500' },
  context:   { label: 'Context',   cls: 'text-stone-700 dark:text-stone-300',         dot: 'bg-stone-500' },
  caution:   { label: 'Caution',   cls: 'text-cyan-600 dark:text-cyan-300',     dot: 'bg-cyan-500' },
};

const FeedCard = ({ narrative, onOpen }: FeedCardProps) => {
  const sent = (narrative.sentiment ?? '').toLowerCase();
  const sentCls = sentimentClasses[sent];
  const showSentiment = narrative.llm_verified && sent && sentCls;
  const displayTickers = narrative.companies_tickers.filter((t) => /^[A-Z0-9.\-]{2,6}$/.test(t));
  const displayHoldings = displayTickers.filter((t) => narrative.holdings_mentioned.includes(t));
  const hasAi = Boolean(narrative.ai_take);
  const stance = (narrative.ai_stance ?? '').toLowerCase();
  const stanceStyle = STANCE_STYLE[stance] ?? STANCE_STYLE['context'];
  const kindLabel = narrative.kind === 'quote' ? 'Quote' : narrative.kind === 'action' ? 'Action' : 'Take';
  const holdingsHit = displayHoldings.length > 0;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpen(narrative.episode_id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(narrative.episode_id)}
      className={`group relative h-full flex flex-col bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden cursor-pointer transition-all hover:border-stone-400 dark:hover:border-stone-600 hover:-translate-y-px hover:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.5)] ${
        holdingsHit ? 'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-cyan-500' : ''
      }`}
    >
      {/* Eyebrow — source / kind / time */}
      <div className="flex items-center gap-2 px-5 pt-4 pb-2">
        <span className="text-xs font-mono text-stone-800 dark:text-stone-200 truncate">
          {narrative.source_name}
        </span>
        <span className="text-stone-300 dark:text-stone-700 text-xs">/</span>
        <span className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">
          {kindLabel}
        </span>
        <span className="ml-auto text-xs text-stone-400 dark:text-stone-500 tabular-nums">
          {daysAgo(narrative.published_at)}
        </span>
      </div>

      {/* Headline — the expert's claim. Medium weight for legibility at this size. */}
      <div className="px-5 pb-3">
        <h3 className="text-lg text-stone-900 dark:text-stone-50 line-clamp-4">
          {narrative.kind === 'quote' ? (
            <span className="italic">“{narrative.text}”</span>
          ) : (
            narrative.text
          )}
        </h3>
        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400 truncate">
          {narrative.episode_title}
        </p>
      </div>

      {/* Metadata row */}
      {(showSentiment || displayTickers.length > 0 || narrative.people_mentioned.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3 text-xs">
          {showSentiment && (
            <span className={`px-2 py-0.5 rounded-sm font-mono uppercase tracking-wider text-xs ${sentCls}`}>
              {sent}
            </span>
          )}
          {narrative.people_mentioned.slice(0, 2).map((p) => (
            <span
              key={p}
              className="px-2 py-0.5 text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-700 rounded-sm"
            >
              {p}
            </span>
          ))}
          {displayHoldings.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm font-mono font-semibold text-xs text-cyan-600 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-500/10 ring-1 ring-cyan-400 dark:ring-cyan-500/40">
              <span aria-hidden>★</span> {displayHoldings.join(' ')}
            </span>
          )}
          {displayTickers
            .filter((t) => !displayHoldings.includes(t))
            .slice(0, 3)
            .map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded-sm font-mono font-semibold text-xs text-stone-600 dark:text-stone-300 bg-stone-100 dark:bg-stone-800"
              >
                {t}
              </span>
            ))}
        </div>
      )}

      {/* Editorial rule + AI analyst note — amber accent anchors the card */}
      <div className="mt-auto px-5 pt-3 pb-4 border-t border-stone-100 dark:border-stone-800">
        {hasAi ? (
          <>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <h4 className="text-lg text-cyan-500 dark:text-cyan-400">
                WG Analyst
              </h4>
              {narrative.ai_method && (
                <span className="text-xs font-mono text-stone-400 dark:text-stone-500 tracking-wider uppercase">
                  {narrative.ai_method}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mb-2 text-xs font-mono uppercase">
              <span className={`inline-flex items-center gap-1 ${stanceStyle.cls}`}>
                <span className={`w-1 h-1 rounded-full ${stanceStyle.dot}`} />
                {stanceStyle.label}
              </span>
              {narrative.ai_confidence && (
                <span className="text-stone-400 dark:text-stone-500">
                  · {narrative.ai_confidence}
                </span>
              )}
            </div>
            <p className="text-lg text-stone-900 dark:text-stone-50 line-clamp-4">
              {narrative.ai_take}
            </p>
            {narrative.ai_portfolio_impact && (
              <div className="mt-3 px-3 py-2 rounded-sm bg-cyan-50 dark:bg-cyan-500/10 border-l-2 border-cyan-500 dark:border-cyan-400 text-base leading-snug text-stone-800 dark:text-stone-100">
                <span className="text-xs font-mono uppercase text-cyan-600 dark:text-cyan-400 block mb-0.5">
                  Portfolio impact
                </span>
                <span className="line-clamp-3">{narrative.ai_portfolio_impact}</span>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs font-mono uppercase text-stone-400 dark:text-stone-500">
            — no analyst note yet
          </p>
        )}
      </div>
    </article>
  );
};

// ============================================================================
// Episode detail modal
// ============================================================================

interface DetailModalProps {
  episode: Episode | null;
  onClose: () => void;
  onUpdated: (e: Episode) => void;
  addToast: ReturnType<typeof useToast>['addToast'];
}

interface AiAnalysis {
  episode_take?: string;
  pod_takes?: Array<{ pod_take_idx: number; stance: string; confidence: string; ai_take: string; tickers?: string[]; portfolio_impact?: string | null }>;
  method?: string;
  generated_at?: string;
}

const DetailModal = ({ episode, onClose, onUpdated, addToast }: DetailModalProps) => {
  const [summarizing, setSummarizing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [summarySource, setSummarySource] = useState<'llm' | 'fallback' | null>(null);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const parsed = useMemo(() => parseSummary(episode?.summary), [episode?.summary]);

  useEffect(() => {
    setSummarySource(null);
    // Load cached ai_analysis from the episode row when present.
    const raw = (episode as Episode & { ai_analysis?: string | null })?.ai_analysis ?? null;
    if (raw) {
      try {
        setAnalysis(JSON.parse(raw));
      } catch {
        setAnalysis(null);
      }
    } else {
      setAnalysis(null);
    }
  }, [episode?.id]);

  if (!episode) return null;

  const runAnalyst = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch(`${API_BASE}/episodes/${episode.id}/analyze?force=true`, { method: 'POST' });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail.slice(0, 160));
      }
      const data: AiAnalysis = await res.json();
      setAnalysis(data);
      addToast(`AiTake ready · ${data.pod_takes?.length ?? 0} takes (${data.method})`, 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Analyst failed', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const reSummarize = async () => {
    setSummarizing(true);
    try {
      const res = await fetch(`${API_BASE}/episodes/${episode.id}/summarize`, { method: 'POST' });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      const source: 'llm' | 'fallback' | undefined = data.source;
      if (source) setSummarySource(source);
      // Re-fetch the episode so the raw summary JSON (now) lands on state.
      const eRes = await fetch(`${API_BASE}/episodes/${episode.id}`);
      if (eRes.ok) {
        const data2 = await eRes.json();
        const fresh: Episode = data2?.episode ?? data2;
        if (fresh && typeof fresh.id === 'number') onUpdated(fresh);
      }
      addToast(source === 'llm' ? 'Re-summarized with AI' : 'Extracted fallback summary', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Summarize failed', 'error');
    } finally {
      setSummarizing(false);
    }
  };

  const setEngagement = async (body: Record<string, unknown>) => {
    try {
      const res = await fetch(`${API_BASE}/episodes/${episode.id}/engagement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      onUpdated({ ...episode, ...(await res.json()) });
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Save failed', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Episode details"
        className="w-full max-w-3xl bg-white dark:bg-stone-900 rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 p-5 border-b border-stone-100 dark:border-stone-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400 mb-1">
              <span>{episode.source_name}</span>
              <span>·</span>
              <span>{daysAgo(episode.published_at)}</span>
              {episode.duration_seconds && (
                <>
                  <span>·</span>
                  <Clock className="w-3 h-3" />
                  <span>{formatDuration(episode.duration_seconds)}</span>
                </>
              )}
            </div>
            <h2 className="text-lg font-bold text-stone-800 dark:text-stone-100">{episode.title}</h2>
            {summarySource && (
              <span
                className={`inline-block mt-1 text-xs uppercase font-semibold px-2 py-0.5 rounded-full ${
                  summarySource === 'llm'
                    ? 'bg-stone-100 text-stone-700 dark:bg-stone-900/30 dark:text-stone-400'
                    : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'
                }`}
              >
                {summarySource === 'llm' ? 'AI summary' : 'Extracted summary'}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-stone-500 dark:text-stone-400" />
          </button>
        </header>

        <div className="p-5 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEngagement({ is_listened: !episode.is_listened })}
              className={`inline-flex items-center gap-1.5 text-base px-3 py-1.5 rounded-lg ${
                episode.is_listened
                  ? 'bg-green-600 text-white'
                  : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-700'
              }`}
            >
              <Check className="w-4 h-4" />
              {episode.is_listened ? 'Listened' : 'Mark as listened'}
            </button>
            <div className="inline-flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setEngagement({ user_rating: n })}
                  title={`Rate ${n}/5`}
                  className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800"
                >
                  <Star
                    className={`w-4 h-4 ${
                      (episode.user_rating ?? 0) >= n
                        ? 'text-cyan-400 fill-cyan-400'
                        : 'text-stone-300 dark:text-stone-600'
                    }`}
                  />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={runAnalyst}
              disabled={analyzing || summarizing}
              className="ml-auto inline-flex items-center gap-1.5 text-base px-3 py-1.5 rounded-lg bg-stone-700 text-white hover:bg-stone-800 disabled:opacity-50"
              title="Run the AI analyst layer — adds AiTake commentary on every key point"
            >
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Run AI analyst
            </button>
            <button
              type="button"
              onClick={reSummarize}
              disabled={summarizing || analyzing}
              className="inline-flex items-center gap-1.5 text-base px-3 py-1.5 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-700 disabled:opacity-50"
              title="Regenerate the expert summary from the episode description/transcript"
            >
              {summarizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Re-summarize
            </button>
            <a
              href={episode.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-base px-3 py-1.5 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-700"
            >
              <ExternalLink className="w-4 h-4" />
              Open
            </a>
          </div>

          {analysis && (
            <section className="bg-stone-50 dark:bg-stone-900/30 border border-stone-200 dark:border-stone-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs uppercase font-semibold px-1.5 py-0.5 rounded bg-stone-700 text-white">
                  <Sparkles className="w-3 h-3" /> AI analyst
                </span>
                {analysis.method && (
                  <span className="text-xs font-mono text-stone-500 dark:text-stone-400">{analysis.method}</span>
                )}
                {analysis.generated_at && (
                  <span className="text-xs text-stone-400 dark:text-stone-500 ml-auto">
                    {daysAgo(analysis.generated_at)}
                  </span>
                )}
              </div>
              {analysis.episode_take && (
                <p className="text-base leading-relaxed text-stone-800 dark:text-stone-100 italic">
                  {analysis.episode_take}
                </p>
              )}
              {analysis.pod_takes && analysis.pod_takes.length > 0 && (
                <ul className="space-y-2.5 text-base">
                  {analysis.pod_takes.map((t) => {
                    const st = STANCE_STYLE[(t.stance ?? '').toLowerCase()] ?? STANCE_STYLE.context;
                    const pod = parsed?.key_points?.[t.pod_take_idx];
                    return (
                      <li key={t.pod_take_idx} className="bg-white/60 dark:bg-stone-900/50 rounded-lg p-3">
                        {pod && (
                          <p className="text-xs text-stone-500 dark:text-stone-400 mb-1">
                            <span className="font-semibold">Pod:</span> {pod}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`text-xs uppercase font-semibold px-1.5 py-0.5 rounded ${st.cls}`}>
                            {st.label}
                          </span>
                          <span className="text-xs text-stone-500 dark:text-stone-400">
                            {t.confidence} confidence
                          </span>
                        </div>
                        <p className="text-stone-700 dark:text-stone-200">{t.ai_take}</p>
                        {t.portfolio_impact && (
                          <p className="mt-1.5 text-xs text-green-800 dark:text-green-300 border-l-2 border-green-400 dark:border-green-600 pl-2">
                            <strong>Portfolio:</strong> {t.portfolio_impact}
                          </p>
                        )}
                        {(t.tickers ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {(t.tickers ?? []).filter((x) => /^[A-Z0-9.\-]{2,6}$/.test(x)).map((x) => (
                              <span
                                key={x}
                                className="px-1.5 py-0.5 rounded font-mono text-xs bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200"
                              >
                                {x}
                              </span>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {parsed ? (
            <>
              {parsed.brief_summary && (
                <section>
                  <h3 className="text-xs uppercase tracking-wide text-stone-400 mb-1">Brief</h3>
                  <p className="text-base text-stone-700 dark:text-stone-200 leading-relaxed">{parsed.brief_summary}</p>
                </section>
              )}

              {parsed.key_points && parsed.key_points.length > 0 && (
                <section>
                  <h3 className="text-xs uppercase tracking-wide text-stone-400 mb-1">Key points</h3>
                  <ul className="space-y-1.5 text-base text-stone-700 dark:text-stone-200">
                    {parsed.key_points.map((p, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-stone-700 dark:text-stone-300 mt-0.5">•</span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {parsed.people_mentioned && parsed.people_mentioned.length > 0 && (
                  <section>
                    <h3 className="text-xs uppercase tracking-wide text-stone-400 mb-1">People</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {parsed.people_mentioned.map((p) => (
                        <span key={p} className="px-2 py-0.5 text-xs rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300">
                          {p}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {parsed.companies_tickers && parsed.companies_tickers.length > 0 && (
                  <section>
                    <h3 className="text-xs uppercase tracking-wide text-stone-400 mb-1">Companies / tickers</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {parsed.companies_tickers.map((t) => (
                        <span key={t} className="px-2 py-0.5 text-xs font-mono rounded-full bg-cyan-50 text-cyan-600 dark:bg-cyan-800/30 dark:text-cyan-300">
                          {t}
                        </span>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              {parsed.notable_quotes && parsed.notable_quotes.length > 0 && (
                <section>
                  <h3 className="text-xs uppercase tracking-wide text-stone-400 mb-1">Notable quotes</h3>
                  <ul className="space-y-2 text-base italic text-stone-700 dark:text-stone-200">
                    {parsed.notable_quotes.map((q, i) => (
                      <li key={i} className="border-l-2 border-stone-400 dark:border-stone-700 pl-3">
                        "{q}"
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {parsed.action_items && parsed.action_items.length > 0 && (
                <section>
                  <h3 className="text-xs uppercase tracking-wide text-stone-400 mb-1">Action items</h3>
                  <ul className="space-y-1.5 text-base text-stone-700 dark:text-stone-200">
                    {parsed.action_items.map((a, i) => (
                      <li key={i} className="flex gap-2">
                        <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <div className="p-4 rounded-lg bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 border-l-cyan-500 text-base text-stone-700 dark:text-stone-300">
              No structured summary available yet. Click <strong>Re-summarize</strong> above to generate one.
            </div>
          )}

          {episode.transcript ? (
            <section className="border-t border-stone-100 dark:border-stone-800 pt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs uppercase tracking-wide text-stone-400">
                  Transcript ({episode.transcript.length.toLocaleString()} chars)
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(episode.transcript || '');
                    addToast('Transcript copied', 'info');
                  }}
                  className="text-xs text-stone-700 dark:text-stone-300 hover:underline"
                >
                  Copy
                </button>
              </div>
              <div className="bg-stone-50 dark:bg-stone-800 p-4 rounded-lg text-base text-stone-600 dark:text-stone-300 whitespace-pre-wrap max-h-72 overflow-y-auto">
                {episode.transcript}
              </div>
            </section>
          ) : (
            <p className="text-xs text-stone-500 dark:text-stone-400 border-t border-stone-100 dark:border-stone-800 pt-4">
              No transcript yet. YouTube episodes pull captions at ingest; podcasts require{' '}
              <code className="text-xs px-1 py-0.5 bg-stone-100 dark:bg-stone-800 rounded">WHISPER_ENABLED=true</code>{' '}
              and an <code className="text-xs px-1 py-0.5 bg-stone-100 dark:bg-stone-800 rounded">OPENAI_API_KEY</code>.
            </p>
          )}

          <section>
            <h3 className="text-xs uppercase tracking-wide text-stone-400 mb-1">Your notes</h3>
            <textarea
              defaultValue={episode.user_notes ?? ''}
              onBlur={(e) => setEngagement({ user_notes: e.target.value })}
              placeholder="Takeaways, rebuttals, follow-ups…"
              rows={3}
              className="w-full text-base border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg px-3 py-2"
            />
          </section>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Feed tab
// ============================================================================

interface FeedProps {
  onOpenEpisode: (id: number) => void;
}

const FeedTab = ({ onOpenEpisode }: FeedProps) => {
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState('');
  const [ticker, setTicker] = useState('');
  const [sourceId, setSourceId] = useState<number | ''>('');
  const [sentiment, setSentiment] = useState<Sentiment>('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [items, setItems] = useState<Narrative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/facets`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Facets | null) => setFacets(d))
      .catch(() => setFacets(null));
  }, []);

  useEffect(() => {
    const qs = new URLSearchParams({ limit: '100' });
    if (person) qs.set('person', person);
    if (ticker) qs.set('ticker', ticker);
    if (sourceId) qs.set('source_id', String(sourceId));
    if (sentiment) qs.set('sentiment', sentiment);
    if (onlyMine) qs.set('only_mine', 'true');
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/narratives?${qs.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const data = await r.json();
        setItems(data.items ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load feed'))
      .finally(() => setLoading(false));
  }, [person, ticker, sourceId, sentiment, onlyMine]);

  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(
      (n) =>
        n.text.toLowerCase().includes(q) ||
        n.episode_title.toLowerCase().includes(q) ||
        n.people_mentioned.some((p) => p.toLowerCase().includes(q)) ||
        n.companies_tickers.some((t) => t.toLowerCase().includes(q)),
    );
  }, [items, query]);

  const clearFilters = () => {
    setPerson('');
    setTicker('');
    setSourceId('');
    setSentiment('');
    setOnlyMine(false);
    setQuery('');
  };

  const anyFilter = Boolean(person || ticker || sourceId || sentiment || onlyMine || query);

  const aiCoverage = items.length > 0 ? items.filter((n) => n.ai_take).length : 0;

  const runBatchAnalyst = async () => {
    try {
      const res = await fetch(`${API_BASE}/analyze/batch?limit=40`, { method: 'POST' });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      // Quick-refresh by nudging a filter dep.
      setOnlyMine((v) => v);
      setSentiment((s) => s);
    } catch {
      /* silent, top-level Sources tab has a toasted version */
    }
  };

  return (
    <div className="flex flex-col xl:flex-row gap-6">
      {/* Main feed column */}
      <div className="flex-1 min-w-0 space-y-5">
        {/* Editorial search-bar (standalone, not a chunky panel) */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search takes, quotes, people, tickers…"
            className="w-full pl-10 pr-3 py-3 text-base tracking-tight border-0 border-b border-stone-200 dark:border-stone-800 bg-transparent focus:outline-none focus:border-stone-900 dark:focus:border-stone-100 placeholder:text-stone-400"
          />
        </div>

        {/* Facet chip clouds */}
        {facets && (facets.people.length > 0 || facets.tickers.length > 0) && (
          <div className="space-y-2">
            {facets.people.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-baseline">
                <span className="text-xs font-mono uppercase text-stone-400 dark:text-stone-500 mr-1">
                  Experts
                </span>
                {facets.people.slice(0, 10).map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => setPerson(person === p.name ? '' : p.name)}
                    className={`px-2 py-0.5 text-xs rounded-sm transition ${
                      person === p.name
                        ? 'bg-cyan-500 text-stone-900 font-medium'
                        : 'text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
                    }`}
                  >
                    {p.name}
                    <span className="ml-1 text-xs font-mono opacity-60">{p.count}</span>
                  </button>
                ))}
              </div>
            )}
            {facets.tickers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-baseline">
                <span className="text-xs font-mono uppercase text-stone-400 dark:text-stone-500 mr-1">
                  Tickers
                </span>
                {facets.tickers.slice(0, 14).map((t) => (
                  <button
                    key={t.ticker}
                    type="button"
                    onClick={() => setTicker(ticker === t.ticker ? '' : t.ticker)}
                    className={`px-2 py-0.5 text-xs font-mono font-semibold rounded-sm transition ${
                      ticker === t.ticker
                        ? 'bg-cyan-500 text-stone-900'
                        : 'text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
                    }`}
                  >
                    {t.ticker}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <ErrorState title="Couldn't load feed" message={error} onRetry={() => setItems([])} />}

        {/* Banner only when coverage is incomplete — editorial tone, not alert */}
        {!loading && items.length > 0 && aiCoverage < items.length && (
          <div className="flex items-start gap-3 pl-4 border-l-2 border-cyan-500 dark:border-cyan-500 text-base">
            <div className="text-stone-700 dark:text-stone-200">
              <span className="text-xs font-mono uppercase text-cyan-600 dark:text-cyan-400">
                Analyst coverage
              </span>
              <p className="mt-0.5 tracking-tight">
                <span className="font-mono tabular-nums">{aiCoverage}</span> of{' '}
                <span className="font-mono tabular-nums">{items.length}</span> takes have WG Analyst notes.
                Run the analyst batch from the rail →
              </p>
            </div>
          </div>
        )}

        {/* The grid */}
        {loading && filtered.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-64 w-full rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white dark:bg-stone-900 rounded-lg border border-dashed border-stone-300 dark:border-stone-700 p-12 text-center text-base text-stone-500 dark:text-stone-400">
            No narratives match. Try clearing filters or ingest more episodes from the Sources tab.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {filtered.map((n) => (
              <FeedCard key={n.id} narrative={n} onOpen={onOpenEpisode} />
            ))}
          </div>
        )}
      </div>

      {/* Right-hand vertical action rail — editorial "contents" column */}
      <aside className="xl:w-56 xl:flex-shrink-0">
        <div className="xl:sticky xl:top-24 space-y-6">
          {/* Filter summary */}
          <div>
            <h4 className="text-xs font-mono uppercase text-stone-400 dark:text-stone-500 mb-2 pb-1.5 border-b border-stone-200 dark:border-stone-800">
              Filters
            </h4>
            <div className="space-y-1.5">
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : '')}
                className="w-full text-xs bg-transparent border-0 border-b border-stone-200 dark:border-stone-800 focus:outline-none focus:border-stone-900 dark:focus:border-stone-100 py-1.5"
              >
                <option value="">All sources</option>
                {facets?.sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <select
                value={sentiment}
                onChange={(e) => setSentiment(e.target.value as Sentiment)}
                className="w-full text-xs bg-transparent border-0 border-b border-stone-200 dark:border-stone-800 focus:outline-none focus:border-stone-900 dark:focus:border-stone-100 py-1.5"
              >
                <option value="">All sentiments</option>
                <option value="bullish">Bullish</option>
                <option value="neutral">Neutral</option>
                <option value="bearish">Bearish</option>
              </select>
              <button
                type="button"
                onClick={() => setOnlyMine((v) => !v)}
                className={`w-full flex items-center justify-between gap-2 py-1.5 px-0 border-b text-xs transition ${
                  onlyMine
                    ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                    : 'border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-300 hover:border-stone-900 dark:hover:border-stone-100'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Filter className="w-3 h-3" />
                  My holdings only
                </span>
                <span className={`text-xs font-mono uppercase tracking-wider ${onlyMine ? 'text-cyan-500 dark:text-cyan-400 font-semibold' : 'text-stone-400'}`}>
                  {onlyMine ? 'on' : 'off'}
                </span>
              </button>
              {anyFilter && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-mono uppercase text-stone-400 hover:text-stone-700 dark:text-stone-300 dark:hover:text-stone-200 pt-1"
                >
                  ⎯ clear filters
                </button>
              )}
            </div>
          </div>

          {/* Actions */}
          <div>
            <h4 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-3 pb-1.5 border-b border-stone-200 dark:border-stone-800">
              Actions
            </h4>

            {/* Primary CTA — the single amber call-to-action */}
            <button
              type="button"
              onClick={runBatchAnalyst}
              className="w-full flex items-center justify-center gap-2 mb-2 px-3 py-2 rounded-sm bg-cyan-500 hover:bg-cyan-500 text-stone-900 text-base tracking-tight transition"
            >
              <Sparkles className="w-4 h-4" strokeWidth={2} />
              Run AI analyst
            </button>

            {/* Secondary actions — row style */}
            <button
              type="button"
              onClick={() => {
                setOnlyMine((v) => v);
                setSentiment((s) => s);
              }}
              className="w-full flex items-center justify-between py-2 text-xs text-stone-700 dark:text-stone-300 border-b border-stone-100 dark:border-stone-800/60 hover:text-stone-900 dark:hover:text-stone-50 transition"
            >
              <span className="flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400" />
                Refresh feed
              </span>
            </button>
          </div>

          {/* Coverage meter */}
          {items.length > 0 && (
            <div>
              <h4 className="text-xs font-mono uppercase text-stone-400 dark:text-stone-500 mb-2 pb-1.5 border-b border-stone-200 dark:border-stone-800">
                Corpus
              </h4>
              <dl className="space-y-1.5 text-xs">
                <div className="flex items-baseline justify-between">
                  <dt className="text-stone-500 dark:text-stone-400">Narratives</dt>
                  <dd className="font-mono tabular-nums text-stone-700 dark:text-stone-200">
                    {items.length}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-stone-500 dark:text-stone-400">AiTake</dt>
                  <dd className="font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
                    {aiCoverage}/{items.length}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-stone-500 dark:text-stone-400">Visible</dt>
                  <dd className="font-mono tabular-nums text-stone-700 dark:text-stone-200">
                    {filtered.length}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

// ============================================================================
// Episodes tab (condensed grid)
// ============================================================================

interface EpisodesProps {
  episodes: Episode[];
  loading: boolean;
  onOpen: (id: number) => void;
}

const EpisodesTab = ({ episodes, loading, onOpen }: EpisodesProps) => (
  <div className="space-y-3">
    {loading ? (
      [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)
    ) : episodes.length === 0 ? (
      <div className="text-center py-12 text-stone-500 dark:text-stone-400">No episodes yet — ingest a source.</div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {episodes.map((ep) => {
          const parsed = parseSummary(ep.summary);
          return (
            <button
              key={ep.id}
              type="button"
              onClick={() => onOpen(ep.id)}
              className="text-left bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-4 hover:border-stone-400 dark:hover:border-stone-700 transition"
            >
              <div className="flex items-center justify-between gap-2 text-xs text-stone-500 dark:text-stone-400 mb-1">
                <span className="truncate">{ep.source_name}</span>
                <span>{daysAgo(ep.published_at)}</span>
              </div>
              <h3 className="text-base font-semibold text-stone-800 dark:text-stone-100 line-clamp-2 mb-2">{ep.title}</h3>
              {parsed?.brief_summary && (
                <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2">{parsed.brief_summary}</p>
              )}
              <div className="flex items-center gap-2 mt-2 text-xs">
                {ep.is_listened ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <Check className="w-3 h-3" /> Listened
                  </span>
                ) : (
                  <span className="text-stone-400">Unlistened</span>
                )}
                {ep.user_rating ? (
                  <span className="inline-flex items-center gap-0.5 text-cyan-500">
                    <Star className="w-3 h-3 fill-cyan-400" />
                    {ep.user_rating}/5
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    )}
  </div>
);

// ============================================================================
// Sources tab
// ============================================================================

interface SourcesProps {
  sources: Source[];
  loading: boolean;
  onRefresh: () => void;
  addToast: ReturnType<typeof useToast>['addToast'];
}

const SourcesTab = ({ sources, loading, onRefresh, addToast }: SourcesProps) => {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<Partial<Source>>({ name: '', source_type: 'podcast', url: '', is_active: true });
  const [busy, setBusy] = useState<number | 'add' | null>(null);

  const save = async () => {
    setBusy('add');
    try {
      const res = await fetch(`${API_BASE}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      setShowAdd(false);
      setForm({ name: '', source_type: 'podcast', url: '', is_active: true });
      addToast('Source added', 'success');
      onRefresh();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Add failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const ingest = async (id: number) => {
    setBusy(id);
    try {
      const res = await fetch(`${API_BASE}/ingest/${id}?max_episodes=5`, { method: 'POST' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.detail ?? `Server error ${res.status}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const n = data.processed ?? 0;
      const total = data.total_found ?? '?';
      if (n > 0) {
        addToast(`${n} new episode${n > 1 ? 's' : ''} ingested (${total} in feed)`, 'success');
      } else {
        addToast(`All ${total} episodes already ingested — nothing new`, 'info');
      }
      onRefresh();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Ingest failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this source? Episodes will remain but no longer refresh.')) return;
    try {
      const res = await fetch(`${API_BASE}/sources/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      addToast('Source deleted', 'info');
      onRefresh();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Delete failed', 'error');
    }
  };

  const runAnalystBatch = async () => {
    setBusy('add');
    try {
      const res = await fetch(`${API_BASE}/analyze/batch?limit=40`, { method: 'POST' });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      addToast(`AI analyst: ${data.ok}/${data.processed} episodes annotated`, 'success');
      onRefresh();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Batch failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-base text-stone-500 dark:text-stone-400">
          {sources.length} source{sources.length === 1 ? '' : 's'}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-base bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 rounded-lg hover:bg-stone-200 dark:hover:bg-stone-700 disabled:opacity-50"
            aria-label="Refresh sources"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={runAnalystBatch}
            disabled={busy === 'add'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-base bg-stone-700 text-white rounded-lg hover:bg-stone-800 disabled:opacity-50"
            title="Run the AI analyst layer on up to 40 episodes"
          >
            {busy === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Run AI analyst (batch)
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-base bg-stone-700 text-white rounded-lg hover:bg-stone-700"
          >
            <Plus className="w-4 h-4" /> Add source
          </button>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-24 rounded-lg" />
      ) : (
        <div className="grid gap-3">
          {sources.map((s) => (
            <div
              key={s.id}
              className="bg-white dark:bg-stone-900 rounded-lg border border-stone-200 dark:border-stone-800 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-xs uppercase font-semibold px-1.5 py-0.5 rounded ${
                        s.source_type === 'youtube'
                          ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                          : 'bg-cyan-50 text-cyan-600 dark:bg-cyan-800/30 dark:text-cyan-300'
                      }`}
                    >
                      {s.source_type}
                    </span>
                    {!s.is_active && (
                      <span className="text-xs uppercase px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
                        inactive
                      </span>
                    )}
                    {s.last_checked_at && (
                      <span className="text-xs text-stone-400">
                        last ingest {daysAgo(s.last_checked_at)}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-semibold text-stone-800 dark:text-stone-100">{s.name}</h3>
                  {s.description && (
                    <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{s.description}</p>
                  )}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-stone-700 dark:text-stone-300 hover:underline truncate inline-block mt-1 max-w-full"
                  >
                    {s.url}
                  </a>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => ingest(s.id)}
                    disabled={busy === s.id}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg disabled:opacity-50 ${
                      busy === s.id
                        ? 'bg-cyan-100 text-cyan-600 dark:bg-cyan-800/30 dark:text-cyan-300'
                        : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
                    }`}
                  >
                    {busy === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    {busy === s.id ? 'Ingesting…' : 'Ingest'}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    className="p-2 rounded hover:bg-red-50 dark:hover:bg-red-950/30"
                    title="Delete"
                    aria-label="Delete episode"
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div
          className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-stone-900 rounded-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-stone-800 dark:text-stone-100">Add source</h3>
            <label className="block">
              <span className="block text-xs text-stone-500 dark:text-stone-400">Name</span>
              <input
                value={form.name ?? ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full text-base border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-stone-500 dark:text-stone-400">Type</span>
              <select
                value={form.source_type}
                onChange={(e) => setForm({ ...form, source_type: e.target.value as 'podcast' | 'youtube' })}
                className="mt-1 w-full text-base border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg px-3 py-2"
              >
                <option value="podcast">Podcast (Apple / RSS)</option>
                <option value="youtube">YouTube channel</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs text-stone-500 dark:text-stone-400">URL</span>
              <input
                value={form.url ?? ''}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder={form.source_type === 'youtube' ? 'https://youtube.com/@channel' : 'https://podcasts.apple.com/…/id12345'}
                className="mt-1 w-full text-base border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg px-3 py-2"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="px-3 py-1.5 text-base rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy === 'add'}
                className="px-3 py-1.5 text-base rounded-lg bg-stone-700 text-white disabled:opacity-50"
              >
                {busy === 'add' ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Page
// ============================================================================

const PodBits = () => {
  const [tab, setTab] = useState<Tab>('feed');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toasts, addToast, removeToast } = useToast();

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [eRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/episodes?limit=100`),
        fetch(`${API_BASE}/sources`),
      ]);
      if (!eRes.ok || !sRes.ok) throw new Error('Failed to load PodBits data');
      const eData = await eRes.json();
      const sData = await sRes.json();
      setEpisodes(eData.episodes ?? []);
      setSources(sData.sources ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const openEpisode = (id: number) => navigate(`/podbits/${id}`);

  const TABS: { id: Tab; label: string; hint: string }[] = [
    { id: 'feed', label: 'Feed', hint: 'Expert takes, one per card' },
    { id: 'episodes', label: 'Episodes', hint: 'Episode catalog' },
    { id: 'sources', label: 'Sources', hint: 'Podcast + YouTube sources' },
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-4">
        <div className="flex items-center justify-center w-10 h-10 rounded bg-stone-900 dark:bg-stone-100 flex-shrink-0">
          <Podcast className="w-5 h-5 text-cyan-500" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-2xl leading-none text-stone-900 dark:text-stone-50">
            PodBits
          </h1>
          <p className="mt-1.5 text-base text-stone-600 dark:text-stone-400 max-w-xl">
            Expert takes from your podcasts, each paired with a <span className="text-cyan-500 dark:text-cyan-400 ">WG Analyst</span> opinion grounded in your portfolio.
          </p>
        </div>
      </header>

      <div className="flex items-center gap-4 border-b border-stone-200 dark:border-stone-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-1 py-2.5 text-base tracking-tight transition border-b-2 -mb-px ${
              tab === t.id
                ? 'border-cyan-500 text-stone-900 dark:text-stone-50'
                : 'border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
            }`}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={loadAll}
          className="ml-auto p-1.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 dark:text-stone-500"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <ErrorState title="Couldn't load PodBits" message={error} onRetry={loadAll} />}

      {tab === 'feed' && <FeedTab onOpenEpisode={openEpisode} />}
      {tab === 'episodes' && <EpisodesTab episodes={episodes} loading={loading} onOpen={openEpisode} />}
      {tab === 'sources' && (
        <SourcesTab sources={sources} loading={loading} onRefresh={loadAll} addToast={addToast} />
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
};

export default PodBits;
