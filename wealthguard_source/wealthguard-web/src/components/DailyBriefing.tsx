import { useEffect, useState } from 'react';
import { Newspaper, RefreshCw, Loader2, ExternalLink } from 'lucide-react';
import Skeleton from './Skeleton';
import ErrorState from './ErrorState';
import SectionHeader from './SectionHeader';

interface DailyArticle {
  title: string;
  source: string;
  date?: string;
  url?: string;
  sentiment?: number;
  body?: string;
}

interface FearGreed { index: number; rating: string; source?: string }
interface GeoEvent { title?: string; description?: string; severity?: string; region?: string }
interface DailyResponse { date: string; fear_greed: FearGreed; top_news: DailyArticle[]; geo_events: GeoEvent[]; signals?: unknown[]; error?: string }
interface MarketSentiment { score: number; label: string; articles_analyzed: number; note?: string; error?: string }

const POLL_MS = 15 * 60 * 1000;

function sentimentLabel(score: number) {
  if (score > 0.2) return 'Bullish';
  if (score < -0.2) return 'Bearish';
  return 'Neutral';
}

function sentimentDot(score: number) {
  if (score > 0.2) return 'bg-emerald-500';
  if (score < -0.2) return 'bg-rose-500';
  return 'bg-stone-400';
}

const DailyBriefing = () => {
  const [daily, setDaily] = useState<DailyResponse | null>(null);
  const [sentiment, setSentiment] = useState<MarketSentiment | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (daily) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const [dRes, sRes] = await Promise.all([
        fetch('/api/intelligence/daily'),
        fetch('/api/news/sentiment'),
      ]);
      if (!dRes.ok) throw new Error(`Intelligence ${dRes.status}`);
      const dData: DailyResponse = await dRes.json();
      const sData: MarketSentiment = sRes.ok ? await sRes.json() : { score: 0, label: 'unavailable', articles_analyzed: 0 };
      setDaily(dData);
      setSentiment(sData);
      if (dData.error && (dData.top_news ?? []).length === 0) setError(dData.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load briefing');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !daily) {
    return (
      <section>
        <SectionHeader icon={Newspaper} label="Today's briefing" />
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </section>
    );
  }

  if (error && !daily) {
    return (
      <section>
        <SectionHeader icon={Newspaper} label="Today's briefing" />
        <ErrorState title="Couldn't load daily briefing" message={error} onRetry={load} />
      </section>
    );
  }

  const score = sentiment?.score ?? 0;
  const articles = (daily?.top_news ?? []).slice(0, 4);
  const analyzed = sentiment?.articles_analyzed ?? 0;
  const fearGreed = daily?.fear_greed;
  const showFG = fearGreed && fearGreed.source !== 'fallback';

  return (
    <section>
      <SectionHeader
        icon={Newspaper}
        label="Today's briefing"
        right={
          <button
            type="button"
            onClick={load}
            disabled={refreshing}
            className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 dark:text-stone-500 disabled:opacity-50"
            title="Refresh"
          >
            {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        }
      />
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 pt-8">
        {/* KPI row — same Survival-Pulse rhythm */}
        <div className="grid grid-cols-2 gap-4 pb-5 mb-5 border-b border-stone-100 dark:border-stone-800">
          <div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${sentimentDot(score)}`} />
              <span className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">Market sentiment</span>
            </div>
            <div className="text-xl tabular-nums mt-1 text-stone-900 dark:text-stone-50">
              {sentimentLabel(score)}
            </div>
            <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 tabular-nums">
              {analyzed} article{analyzed === 1 ? '' : 's'} analysed
            </div>
          </div>
          <div>
            <div className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">Fear &amp; Greed</div>
            <div className="text-xl tabular-nums mt-1 text-stone-900 dark:text-stone-50">
              {showFG ? fearGreed!.index : '—'}
            </div>
            <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              {showFG ? fearGreed!.rating : 'index unavailable'}
            </div>
          </div>
        </div>

        {/* Headlines */}
        {articles.length === 0 ? (
          <p className="text-base text-stone-500 dark:text-stone-400">
            No articles returned.
          </p>
        ) : (
          <ul className="space-y-3">
            {articles.map((a, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className={`mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0 ${sentimentDot(a.sentiment ?? 0)}`} />
                <div className="min-w-0 flex-1">
                  {a.url ? (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-lg text-stone-900 dark:text-stone-100 hover:text-cyan-500 dark:hover:text-cyan-400 line-clamp-2 inline"
                    >
                      {a.title}
                      <ExternalLink className="inline w-3 h-3 ml-1 text-stone-400" />
                    </a>
                  ) : (
                    <span className="text-lg text-stone-900 dark:text-stone-100 line-clamp-2">{a.title}</span>
                  )}
                  <p className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mt-0.5 truncate">
                    {a.source}{a.date ? ` · ${a.date.slice(0, 10)}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

export default DailyBriefing;
