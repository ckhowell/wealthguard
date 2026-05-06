import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Receipt,
  PieChart,
  Bell,
  Menu,
  X,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Lightbulb,
  Globe,
  BarChart3,
  Podcast,
  Scale,
  Upload,
  Target,
  Settings as SettingsIcon,
  Map,
  Bot,
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Portfolio from './pages/Portfolio';
import Transactions from './pages/Transactions';
import Alerts from './pages/Alerts';
import Advisor from './pages/Advisor';
import Performance from './pages/Performance';
import Spending from './pages/Spending';
import Plan from './pages/Plan';
import AgentRuns from './pages/AgentRuns';
import Markets from './pages/Markets';
import PodBits from './pages/PodBits';
import EpisodeDetail from './pages/EpisodeDetail';
import Rebalancer from './pages/Rebalancer';
import Import from './pages/Import';
import Goals from './pages/Goals';
import Settings from './pages/Settings';
import Vision from './pages/Vision';
// AShare deleted (Iteration 20: folded into Markets CN tab).
// Vision rebuilt as a Recharts-only infographic dashboard (WS4) — accessible
// at /vision but intentionally not in the sidebar.
// Projects, CashFlow, ExpenseAnalysis, Budgets are now mounted as sub-tabs
// inside Plan and Spending hosts — they're imported transitively via Plan.tsx
// and Spending.tsx.
import ErrorBoundary from './components/ErrorBoundary';
import Skeleton from './components/Skeleton';
import ThemeToggle from './components/ThemeToggle';
import SyncStatusBadge from './components/SyncStatusBadge';
import CommandPalette from './components/CommandPalette';
import ShortcutsCheatsheet from './components/ShortcutsCheatsheet';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useNetWorth } from './hooks/useNetWorth';
import { useIncome } from './hooks/useIncome';
import { useTheme } from './hooks/useTheme';
import './index.css';

// Sidebar nav (Iteration 20 consolidation): 20 → 14 entries.
//   Removed: /ashare (folded into Markets CN tab),
//            /vision (fluff per CLAUDE.md),
//            /projects, /cashflow, /budgets (now sub-tabs).
//   Renamed: /expenses → /spending (with sub-tabs Analysis/Cash Flow/Budgets).
//   Plan now hosts a Plan/Projects sub-tab pair.
const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/portfolio', icon: PieChart, label: 'Portfolio' },
  { path: '/rebalancer', icon: Scale, label: 'Rebalancer' },
  { path: '/goals', icon: Target, label: 'Goals' },
  { path: '/performance', icon: BarChart3, label: 'Performance' },
  { path: '/spending', icon: Receipt, label: 'Spending' },
  { path: '/plan', icon: Map, label: 'Retirement Plan' },
  { path: '/agents', icon: Bot, label: 'Agent Harness' },
  { path: '/advisor', icon: Lightbulb, label: 'Advisor' },
  { path: '/podbits', icon: Podcast, label: 'PodBits' },
  { path: '/markets', icon: Globe, label: 'Markets (US/AU/CN)' },
  { path: '/transactions', icon: Receipt, label: 'Transactions' },
  { path: '/import', icon: Upload, label: 'Import' },
  { path: '/alerts', icon: Bell, label: 'Alerts' },
  { path: '/settings', icon: SettingsIcon, label: 'Settings' },
];

function fmtShort(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${v < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 100_000) return `${v < 0 ? '-' : ''}$${Math.round(abs / 1000)}k`;
  if (abs >= 1_000) return `${v < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`;
  return `${v < 0 ? '-' : ''}$${Math.round(abs)}`;
}

function NetWorthHeader() {
  const nw = useNetWorth();
  const income = useIncome();
  const formatted = nw.valueAud.toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
  });
  const delta = nw.deltaPct30d;
  const isPositive = delta == null ? true : delta >= 0;
  const surplusPositive = income.net_surplus_per_month >= 0;

  return (
    <div>
      <div className="flex items-baseline gap-3">
        {nw.isLoading && nw.valueAud === 0 ? (
          <Skeleton className="h-10 w-56" />
        ) : (
          <h2 className="text-3xl sm:text-4xl tracking-tight text-stone-900 dark:text-stone-50 tabular-nums">
            {formatted}
          </h2>
        )}
      </div>
      <p className="text-xs sm:text-xs font-mono uppercase tracking-widest text-stone-500 dark:text-stone-400 mt-1">
        {nw.error ? (
          <span className="text-stone-700 dark:text-stone-300">Couldn't refresh — showing last value</span>
        ) : nw.lastUpdated ? (
          <>Net worth AUD · updated {new Date(nw.lastUpdated).toLocaleTimeString()}</>
        ) : (
          <>Net worth AUD</>
        )}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono tabular-nums">
        {delta != null && (
          <span className="inline-flex items-center gap-1.5 text-stone-600 dark:text-stone-400">
            {isPositive ? (
              <TrendingUp className="w-3 h-3" style={{ color: 'var(--positive)' }} />
            ) : (
              <TrendingDown className="w-3 h-3" style={{ color: 'var(--negative)' }} />
            )}
            {(isPositive ? '+' : '') + delta.toFixed(2)}% · 30D
          </span>
        )}
        {!income.loading && income.total_monthly > 0 && (
          <span className="inline-flex items-center gap-1.5 text-stone-600 dark:text-stone-400">
            <span className="uppercase text-stone-400 dark:text-stone-500">In</span>
            +{fmtShort(income.total_monthly)}/mo
          </span>
        )}
        {!income.loading && income.total_monthly > 0 && (
          <span className={`inline-flex items-center gap-1.5 ${surplusPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            <span className="uppercase text-stone-400 dark:text-stone-500">Net</span>
            {surplusPositive ? '+' : ''}{fmtShort(income.net_surplus_per_month)}/mo
          </span>
        )}
      </div>
    </div>
  );
}

function Sidebar({
  open,
  desktopCollapsed,
  onToggleDesktop,
  onCloseMobile,
}: {
  open: boolean;
  desktopCollapsed: boolean;
  onToggleDesktop: () => void;
  onCloseMobile: () => void;
}) {
  const expanded = !desktopCollapsed;
  return (
    <aside
      className={`bg-stone-950 text-stone-300 flex flex-col fixed inset-y-0 left-0 z-40 transition-transform duration-300 border-r border-stone-800
        ${open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
        ${expanded ? 'w-60' : 'w-14'}`}
      aria-label="Primary navigation"
    >
      <div className="px-4 py-5 border-b border-stone-800 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-sm flex items-center justify-center flex-shrink-0 bg-stone-800">
            <DollarSign className="w-4 h-4 text-stone-300" strokeWidth={2} />
          </div>
          {expanded && (
            <div className="min-w-0">
              <h1 className="text-base tracking-tight text-stone-50">WealthGuard</h1>
              <p className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mt-0.5">terminal</p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="md:hidden p-1.5 hover:bg-stone-800 rounded"
          aria-label="Close navigation"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 px-2 py-4 overflow-y-auto">
        <ul className="space-y-0.5">
          {navItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                onClick={onCloseMobile}
                className={({ isActive }) => `
                  flex items-center gap-3 px-3 py-2 rounded-sm transition-colors text-base tracking-tight
                  ${isActive
                    ? 'bg-stone-800 text-stone-50 border-l-2 border-cyan-500 pl-[10px]'
                    : 'text-stone-400 hover:bg-stone-900 hover:text-stone-100 border-l-2 border-transparent pl-[10px]'}
                `}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
                {expanded && <span>{item.label}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <button
        type="button"
        onClick={onToggleDesktop}
        className="hidden md:flex items-center justify-center py-3 border-t border-stone-800 hover:bg-stone-900 text-stone-500 dark:text-stone-400 hover:text-stone-300 transition-colors"
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {expanded ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
      </button>
    </aside>
  );
}

function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const location = useLocation();
  useTheme();
  useKeyboardShortcuts({
    onCommand: () => setCommandOpen((v) => !v),
    onHelp: () => setHelpOpen((v) => !v),
  });

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100">
      <Sidebar
        open={mobileOpen}
        desktopCollapsed={desktopCollapsed}
        onToggleDesktop={() => setDesktopCollapsed((v) => !v)}
        onCloseMobile={() => setMobileOpen(false)}
      />

      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation overlay"
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 bg-black/40 z-30"
        />
      )}

      <main
        className={`transition-all duration-300 ${
          desktopCollapsed ? 'md:ml-14' : 'md:ml-60'
        }`}
      >
        <header className="bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 px-4 sm:px-6 py-3 sm:py-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-2 -ml-2 rounded hover:bg-stone-100 dark:hover:bg-stone-800"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5 text-stone-700 dark:text-stone-300" />
            </button>
            <div className="flex-1 min-w-0">
              <NetWorthHeader />
            </div>
            <SyncStatusBadge />
            <ThemeToggle />
          </div>
        </header>

        <div className="p-4 sm:p-6">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/portfolio" element={<Portfolio />} />
              <Route path="/rebalancer" element={<Rebalancer />} />
              <Route path="/goals" element={<Goals />} />
              <Route path="/performance" element={<Performance />} />
              <Route path="/spending" element={<Spending />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/agents" element={<AgentRuns />} />
              <Route path="/advisor" element={<Advisor />} />
              <Route path="/podbits" element={<PodBits />} />
              <Route path="/podbits/:id" element={<EpisodeDetail />} />
              <Route path="/markets" element={<Markets />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/import" element={<Import />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/settings" element={<Settings />} />
              {/* Legacy redirects — Iteration 20 consolidated these surfaces
                  into sub-tabs. Bookmarks, the rebuke ribbon's action_link,
                  and any external links continue to land on the right tab. */}
              <Route path="/projects" element={<Navigate to="/plan?tab=projects" replace />} />
              <Route path="/expenses" element={<Navigate to="/spending" replace />} />
              <Route path="/cashflow" element={<Navigate to="/spending?tab=cashflow" replace />} />
              <Route path="/budgets" element={<Navigate to="/spending?tab=budgets" replace />} />
              {/* AShare folded into Markets — query param drives the CN tab. */}
              <Route path="/ashare" element={<Navigate to="/markets?market=CN" replace />} />
              {/* Vision — Recharts-only infographic dashboard (WS4). */}
              <Route path="/vision" element={<Vision />} />
            </Routes>
          </ErrorBoundary>
        </div>
      </main>

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      <ShortcutsCheatsheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

function App() {
  return (
    <Router>
      <Layout />
    </Router>
  );
}

export default App;
