import { useEffect, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, PieChart, Scale, BarChart3, TrendingUp as TrendingUpIcon,
  Lightbulb, Podcast, Globe, Receipt, Upload, Wallet, Bell, Settings as SettingsIcon,
  Target, Search, Newspaper, Tag, Building2, CircleDollarSign,
  Map, Hammer,
} from 'lucide-react';

// ---- types returned by /api/search ----
interface SearchHolding { id: number; symbol: string; asset_name: string | null; asset_class: string; }
interface SearchAccount { id: number; name: string; type: string; currency: string; institution: string | null; current_balance: number | null; }
interface SearchGoal { id: number; name: string; target_amount: number | null; target_date: string | null; }
interface SearchTxn { id: number; transaction_date: string; payee: string | null; amount: number; category: string | null; currency: string | null; account_name: string | null; }
interface SearchCatOrMerchant { name: string; n: number; spend: number | null; last_seen?: string; }
interface SearchEpisode { episode_id: number; title: string; source_name: string | null; }
interface SearchResp {
  query: string;
  holdings: SearchHolding[];
  accounts: SearchAccount[];
  goals: SearchGoal[];
  transactions: SearchTxn[];
  categories: SearchCatOrMerchant[];
  merchants: SearchCatOrMerchant[];
  episodes: SearchEpisode[];
  counts: Record<string, number>;
}

// Iteration 20: paths re-pointed to consolidated routes. Cash Flow / Expense
// Analysis / Budgets all live as sub-tabs of /spending; A-Share is a query
// param into Markets; Vision was deleted (fluff). The legacy paths still
// resolve (App.tsx Routes block has redirects) but jumping straight to the
// consolidated URL avoids one extra navigation.
const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, keywords: 'home overview' },
  { path: '/portfolio', label: 'Portfolio', icon: PieChart, keywords: 'holdings positions' },
  { path: '/rebalancer', label: 'Rebalancer', icon: Scale, keywords: 'target allocation' },
  { path: '/goals', label: 'Goals', icon: Target, keywords: 'target milestone' },
  { path: '/performance', label: 'Performance', icon: BarChart3, keywords: 'twr irr benchmark returns' },
  { path: '/spending', label: 'Spending', icon: Receipt, keywords: 'expenses cash flow budgets category merchant insights spending' },
  { path: '/spending?tab=cashflow', label: 'Cash Flow', icon: TrendingUpIcon, keywords: 'cash flow income forecast' },
  { path: '/spending?tab=budgets', label: 'Budgets', icon: Wallet, keywords: 'spending budget' },
  { path: '/plan', label: 'Plan', icon: Map, keywords: 'retirement plan acacia lind tasmania' },
  { path: '/plan?tab=projects', label: 'Projects', icon: Hammer, keywords: 'projects acacia reno lind build' },
  { path: '/advisor', label: 'Advisor', icon: Lightbulb, keywords: 'signals opportunities recommendations' },
  { path: '/podbits', label: 'PodBits', icon: Podcast, keywords: 'podcast episode summary' },
  { path: '/markets', label: 'Markets', icon: Globe, keywords: 'us au cn market a-share china stocks' },
  { path: '/transactions', label: 'Transactions', icon: Receipt, keywords: 'txn history' },
  { path: '/import', label: 'Import CSV', icon: Upload, keywords: 'upload csv bank' },
  { path: '/alerts', label: 'Alerts', icon: Bell, keywords: 'notifications' },
  { path: '/settings', label: 'Settings', icon: SettingsIcon, keywords: 'preferences export backup' },
];

const fmtAud = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });

interface Props { open: boolean; onOpenChange: (open: boolean) => void; }

const CommandPalette = ({ open, onOpenChange }: Props) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResp | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const abortRef = useRef<AbortController | null>(null);

  // Debounced server-side search on query change.
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit_per=12`, { signal: ctrl.signal });
        if (res.ok) setResults(await res.json());
      } catch { /* aborted or network */ }
      finally { setLoading(false); }
    }, 180);
    return () => clearTimeout(timer);
  }, [open, query]);

  const go = (path: string) => {
    onOpenChange(false);
    setQuery('');
    setResults(null);
    navigate(path);
  };

  const hasResults = results && (
    results.holdings.length + results.accounts.length + results.goals.length +
    results.transactions.length + results.categories.length + results.merchants.length +
    results.episodes.length
  ) > 0;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command menu"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40"
      shouldFilter={false}
    >
      <div
        className="w-[92vw] max-w-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100 dark:border-stone-800">
          <Search className={`w-4 h-4 ${loading ? 'text-cyan-500 animate-pulse' : 'text-stone-400'}`} />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search anything: page, holding, account, goal, transaction, merchant, category, episode…"
            className="flex-1 bg-transparent outline-none text-base text-stone-800 dark:text-stone-100 placeholder:text-stone-400"
          />
          <kbd className="hidden sm:inline text-xs font-mono px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
            Esc
          </kbd>
        </div>

        <Command.List className="max-h-[65vh] overflow-y-auto p-2">
          {/* Always show pages, filtered client-side if query matches */}
          <Command.Group
            heading="Pages"
            className="text-xs uppercase tracking-wide text-stone-400 px-2 pt-1"
          >
            {NAV_ITEMS.filter(item => {
              if (!query.trim()) return true;
              const q = query.toLowerCase();
              return item.label.toLowerCase().includes(q) || item.keywords.includes(q);
            }).slice(0, query.trim() ? 6 : 16).map((item) => (
              <Command.Item
                key={item.path}
                value={`page-${item.path}`}
                onSelect={() => go(item.path)}
                className="flex items-center gap-3 px-3 py-2 rounded-md text-base text-stone-700 dark:text-stone-200 data-[selected=true]:bg-stone-100 dark:data-[selected=true]:bg-stone-800 cursor-pointer"
              >
                <item.icon className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                <span>{item.label}</span>
              </Command.Item>
            ))}
          </Command.Group>

          {query.trim().length < 2 && (
            <div className="px-4 py-6 text-center text-xs text-stone-400">
              Start typing to search holdings, accounts, transactions, merchants, categories, goals, and podcasts.
            </div>
          )}

          {results && (
            <>
              {results.holdings.length > 0 && (
                <Command.Group heading={`Holdings (${results.holdings.length})`} className="text-xs uppercase tracking-wide text-stone-400 px-2 pt-3">
                  {results.holdings.map(h => (
                    <Command.Item
                      key={`h-${h.id}`}
                      value={`holding-${h.id}`}
                      onSelect={() => go(`/portfolio?focus=${encodeURIComponent(h.symbol)}`)}
                      className="flex items-center gap-3 px-3 py-2 rounded-md text-base data-[selected=true]:bg-stone-100 dark:data-[selected=true]:bg-stone-800 cursor-pointer"
                    >
                      <PieChart className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                      <span className="text-stone-800 dark:text-stone-100">{h.symbol}</span>
                      <span className="text-xs text-stone-500 dark:text-stone-400 truncate flex-1">{h.asset_name || ''}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">{h.asset_class}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {results.accounts.length > 0 && (
                <Command.Group heading={`Accounts (${results.accounts.length})`} className="text-xs uppercase tracking-wide text-stone-400 px-2 pt-3">
                  {results.accounts.map(a => (
                    <Command.Item
                      key={`a-${a.id}`}
                      value={`account-${a.id}`}
                      onSelect={() => go(`/expenses?account_id=${a.id}`)}
                      className="flex items-center gap-3 px-3 py-2 rounded-md text-base data-[selected=true]:bg-stone-100 dark:data-[selected=true]:bg-stone-800 cursor-pointer"
                    >
                      <Building2 className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                      <span className="text-stone-800 dark:text-stone-100 truncate flex-1">{a.name}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">{a.type}</span>
                      <span className="text-xs text-stone-500 dark:text-stone-400 whitespace-nowrap">{fmtAud(a.current_balance)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {results.categories.length > 0 && (
                <Command.Group heading={`Categories (${results.categories.length})`} className="text-xs uppercase tracking-wide text-stone-400 px-2 pt-3">
                  {results.categories.map(c => (
                    <Command.Item
                      key={`c-${c.name}`}
                      value={`cat-${c.name}`}
                      onSelect={() => go(`/expenses?category=${encodeURIComponent(c.name)}`)}
                      className="flex items-center gap-3 px-3 py-2 rounded-md text-base data-[selected=true]:bg-stone-100 dark:data-[selected=true]:bg-stone-800 cursor-pointer"
                    >
                      <Tag className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                      <span className="text-stone-800 dark:text-stone-100 truncate flex-1">{c.name}</span>
                      <span className="text-xs text-stone-500 dark:text-stone-400 whitespace-nowrap">{c.n} txns · {fmtAud(c.spend)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {results.merchants.length > 0 && (
                <Command.Group heading={`Merchants (${results.merchants.length})`} className="text-xs uppercase tracking-wide text-stone-400 px-2 pt-3">
                  {results.merchants.map(m => (
                    <Command.Item
                      key={`m-${m.name}`}
                      value={`merchant-${m.name}`}
                      onSelect={() => go(`/expenses?merchant=${encodeURIComponent(m.name)}`)}
                      className="flex items-center gap-3 px-3 py-2 rounded-md text-base data-[selected=true]:bg-stone-100 dark:data-[selected=true]:bg-stone-800 cursor-pointer"
                    >
                      <CircleDollarSign className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                      <span className="text-stone-800 dark:text-stone-100 truncate flex-1">{m.name}</span>
                      <span className="text-xs text-stone-500 dark:text-stone-400 whitespace-nowrap">{m.n} txns · {fmtAud(m.spend)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {results.transactions.length > 0 && (
                <Command.Group
                  heading={`Transactions (${results.transactions.length}${results.counts?.transactions_total && results.counts.transactions_total > results.transactions.length ? ` of ${results.counts.transactions_total}` : ''})`}
                  className="text-xs uppercase tracking-wide text-stone-400 px-2 pt-3"
                >
                  {results.transactions.map(t => (
                    <Command.Item
                      key={`t-${t.id}`}
                      value={`txn-${t.id}`}
                      onSelect={() => go(`/transactions?focus=${t.id}`)}
                      className="flex items-center gap-3 px-3 py-2 rounded-md text-base data-[selected=true]:bg-stone-100 dark:data-[selected=true]:bg-stone-800 cursor-pointer"
                    >
                      <Receipt className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                      <span className="text-stone-800 dark:text-stone-100 truncate flex-1">{t.payee || '—'}</span>
                      {t.category && <span className="text-xs px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">{t.category}</span>}
                      <span className={`text-xs whitespace-nowrap ${t.amount < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fmtAud(t.amount)}</span>
                      <span className="text-xs text-stone-400 whitespace-nowrap">{t.transaction_date}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {results.goals.length > 0 && (
                <Command.Group heading={`Goals (${results.goals.length})`} className="text-xs uppercase tracking-wide text-stone-400 px-2 pt-3">
                  {results.goals.map(g => (
                    <Command.Item
                      key={`g-${g.id}`}
                      value={`goal-${g.id}`}
                      onSelect={() => go(`/goals`)}
                      className="flex items-center gap-3 px-3 py-2 rounded-md text-base data-[selected=true]:bg-stone-100 dark:data-[selected=true]:bg-stone-800 cursor-pointer"
                    >
                      <Target className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                      <span className="text-stone-800 dark:text-stone-100 truncate flex-1">{g.name}</span>
                      <span className="text-xs text-stone-500 dark:text-stone-400 whitespace-nowrap">{fmtAud(g.target_amount)}</span>
                      {g.target_date && <span className="text-xs text-stone-400 whitespace-nowrap">by {g.target_date}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {results.episodes.length > 0 && (
                <Command.Group heading={`Episodes (${results.episodes.length})`} className="text-xs uppercase tracking-wide text-stone-400 px-2 pt-3">
                  {results.episodes.map(e => (
                    <Command.Item
                      key={`e-${e.episode_id}`}
                      value={`episode-${e.episode_id}`}
                      onSelect={() => go(`/podbits?focus=${e.episode_id}`)}
                      className="flex items-center gap-3 px-3 py-2 rounded-md text-base data-[selected=true]:bg-stone-100 dark:data-[selected=true]:bg-stone-800 cursor-pointer"
                    >
                      <Newspaper className="w-4 h-4 text-stone-500 dark:text-stone-400" />
                      <span className="text-stone-800 dark:text-stone-100 truncate flex-1">{e.title}</span>
                      <span className="text-xs text-stone-400 whitespace-nowrap">{e.source_name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {!hasResults && query.trim().length >= 2 && !loading && (
                <Command.Empty className="px-3 py-6 text-center text-base text-stone-500 dark:text-stone-400">
                  No matches for "{query}".
                </Command.Empty>
              )}
            </>
          )}
        </Command.List>

        <div className="flex items-center justify-between px-4 py-2 border-t border-stone-100 dark:border-stone-800 text-xs text-stone-500 dark:text-stone-400">
          <span>
            <kbd className="font-mono px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800">↑↓</kbd> navigate
            <kbd className="font-mono px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 ml-2">↵</kbd> select
          </span>
          <span>
            Press <kbd className="font-mono px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800">?</kbd> for shortcuts
          </span>
        </div>
      </div>
    </Command.Dialog>
  );
};

export default CommandPalette;
