import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles, Loader2 } from 'lucide-react';
import SectionHeader from './SectionHeader';

interface Narrative {
  id: string;
  episode_id: number;
  episode_title: string;
  source_name: string;
  published_at?: string;
  text: string;
  ai_take?: string | null;
  ai_stance?: string | null;
  ai_portfolio_impact?: string | null;
  holdings_mentioned: string[];
}

const STANCE_DOT: Record<string, string> = {
  agrees: 'bg-emerald-500',
  disagrees: 'bg-rose-500',
  caution: 'bg-cyan-500',
  context: 'bg-stone-500',
};

function daysAgo(iso?: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const days = Math.round((Date.now() - t) / (24 * 3600 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return '1d';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

const TakesOnHoldings = () => {
  const [items, setItems] = useState<Narrative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/podbits/narratives?only_mine=true&limit=6');
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        if (!cancelled) setItems(data.items ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Stay quiet when nothing correlates.
  if (!loading && items.length === 0 && !error) return null;

  return (
    <section>
      <SectionHeader
        icon={Sparkles}
        label="Analyst takes on your holdings"
        right={
          <Link
            to="/podbits"
            className="inline-flex items-center gap-1 text-xs text-cyan-500 dark:text-cyan-400 hover:text-cyan-600"
          >
            All takes <ArrowRight className="w-3 h-3" />
          </Link>
        }
      />
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl py-4 divide-y divide-stone-100 dark:divide-stone-800">
        {loading && items.length === 0 ? (
          <div className="p-6 flex items-center gap-2 text-base text-stone-500 dark:text-stone-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning recent episodes…
          </div>
        ) : error ? (
          <div className="p-6 text-xs text-rose-600 dark:text-rose-400">{error}</div>
        ) : (
          items.map((n) => {
            const stance = (n.ai_stance ?? '').toLowerCase();
            const dot = STANCE_DOT[stance] ?? 'bg-stone-400';
            return (
              <Link
                key={n.id}
                to={`/podbits?focus=${n.episode_id}`}
                className="block px-6 py-4 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition"
              >
                {/* Eyebrow row — source · tickers · days */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">
                    {n.source_name}
                  </span>
                  {n.holdings_mentioned.slice(0, 3).map((h) => (
                    <span
                      key={h}
                      className="text-xs font-mono tabular-nums px-1.5 py-0.5 rounded border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-200"
                    >
                      {h}
                    </span>
                  ))}
                  <span className="ml-auto text-xs font-mono tabular-nums text-stone-400 dark:text-stone-500">
                    {daysAgo(n.published_at)}
                  </span>
                </div>

                {/* Pod claim */}
                <p className="text-lg text-stone-900 dark:text-stone-50 line-clamp-2 mb-2">
                  {n.text}
                </p>

                {/* WG Analyst response */}
                {n.ai_take && (
                  <div className="flex items-start gap-2">
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                    <p className="text-lg text-stone-900 dark:text-stone-100 line-clamp-2">
                      <span className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mr-1">
                        WG · {stance || 'context'}
                      </span>
                      {n.ai_take}
                    </p>
                  </div>
                )}
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
};

export default TakesOnHoldings;
