import { useEffect, useRef, useState } from 'react';
import { Newspaper, X, ExternalLink, Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface NewsArticle {
  title: string;
  source: string;
  url?: string;
  published_at?: string;
  summary?: string;
  sentiment?: number;
}

interface NewsResponse {
  symbol: string;
  count: number;
  articles: NewsArticle[];
  error?: string;
}

function sentimentIcon(score?: number) {
  if (score == null) return { Icon: Minus, cls: 'text-stone-400' };
  if (score > 0.2) return { Icon: TrendingUp, cls: 'text-green-500' };
  if (score < -0.2) return { Icon: TrendingDown, cls: 'text-red-500' };
  return { Icon: Minus, cls: 'text-stone-400' };
}

interface Props {
  symbol: string;
  assetName?: string;
}

const HoldingNewsPopover = ({ symbol, assetName }: Props) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || articles.length > 0) return;
    setLoading(true);
    setError(null);
    fetch(`/api/news/portfolio/${encodeURIComponent(symbol)}?limit=5`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const data: NewsResponse = await r.json();
        if (data.error) throw new Error(data.error);
        setArticles(data.articles.slice(0, 5));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load news'))
      .finally(() => setLoading(false));
  }, [open, symbol, articles.length]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 dark:text-stone-500 hover:text-cyan-500 dark:hover:text-cyan-400"
        title={`News for ${symbol}`}
        aria-expanded={open}
      >
        <Newspaper className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`News for ${symbol}`}
          className="absolute right-0 z-30 mt-2 w-80 sm:w-96 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg shadow-xl"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 dark:border-stone-800">
            <div className="min-w-0">
              <p className="text-base font-semibold text-stone-800 dark:text-stone-100 truncate">
                {assetName || symbol} news
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400">Last 7 days · NewsAPI</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800"
              aria-label="Close news"
            >
              <X className="w-4 h-4 text-stone-500 dark:text-stone-400" />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading && (
              <div className="p-6 flex items-center justify-center gap-2 text-stone-500 dark:text-stone-400 text-base">
                <Loader2 className="w-4 h-4 animate-spin" />
                Fetching news…
              </div>
            )}

            {!loading && error && (
              <div className="p-4 text-base text-rose-600 dark:text-rose-400">{error}</div>
            )}

            {!loading && !error && articles.length === 0 && (
              <div className="p-6 text-base text-stone-500 dark:text-stone-400 text-center">
                No recent coverage for {symbol}.
              </div>
            )}

            {!loading && !error && articles.length > 0 && (
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {articles.map((a, i) => {
                  const { Icon, cls } = sentimentIcon(a.sentiment);
                  return (
                    <li key={i} className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${cls}`} />
                        <div className="min-w-0 flex-1">
                          {a.url ? (
                            <a
                              href={a.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-base text-stone-800 dark:text-stone-100 hover:text-cyan-500 dark:hover:text-cyan-400 line-clamp-2"
                            >
                              {a.title}
                              <ExternalLink className="inline w-3 h-3 ml-1 text-stone-400" />
                            </a>
                          ) : (
                            <span className="text-base text-stone-800 dark:text-stone-100">{a.title}</span>
                          )}
                          <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                            {a.source}
                            {a.published_at ? ` · ${new Date(a.published_at).toLocaleDateString()}` : ''}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default HoldingNewsPopover;
