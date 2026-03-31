import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Wallet, 
  Receipt, 
  PieChart, 
  Bell, 
  Menu,
  X,
  DollarSign,
  TrendingUp,
  Lightbulb,
  Globe,
  BarChart3,
  TrendingUp as TrendingUpIcon,
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Portfolio from './pages/Portfolio';
import Transactions from './pages/Transactions';
import Budgets from './pages/Budgets';
import Alerts from './pages/Alerts';
import Advisor from './pages/Advisor';
import AShare from './pages/AShare';
import Performance from './pages/Performance';
import CashFlow from './pages/CashFlow';
import './index.css';

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [netWorth] = useState(3828255.31);

  const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/portfolio', icon: PieChart, label: 'Portfolio' },
    { path: '/performance', icon: BarChart3, label: 'Performance' },
    { path: '/cashflow', icon: TrendingUpIcon, label: 'Cash Flow' },
    { path: '/advisor', icon: Lightbulb, label: 'Advisor' },
    { path: '/ashare', icon: Globe, label: 'A-Share' },
    { path: '/transactions', icon: Receipt, label: 'Transactions' },
    { path: '/budgets', icon: Wallet, label: 'Budgets' },
    { path: '/alerts', icon: Bell, label: 'Alerts' },
  ];

  return (
    <Router>
      <div className="min-h-screen bg-slate-50 flex">
        {/* Sidebar */}
        <aside 
          className={`${sidebarOpen ? 'w-64' : 'w-16'} 
            bg-slate-900 text-white transition-all duration-300 
            flex flex-col fixed h-full z-20`}
        >
          {/* Logo */}
          <div className="p-4 border-b border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-white" />
              </div>
              {sidebarOpen && (
                <div>
                  <h1 className="font-bold text-lg">WealthGuard</h1>
                  <p className="text-xs text-slate-400">AI-Powered Finance</p>
                </div>
              )}
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4">
            <ul className="space-y-2">
              {navItems.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    className={({ isActive }) => `
                      flex items-center gap-3 px-4 py-3 rounded-lg transition-colors
                      ${isActive 
                        ? 'bg-blue-600 text-white' 
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }
                    `}
                  >
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    {sidebarOpen && <span>{item.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* Toggle Button */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-4 border-t border-slate-700 hover:bg-slate-800 transition-colors"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </aside>

        {/* Main Content */}
        <main className={`flex-1 transition-all duration-300 ${sidebarOpen ? 'ml-64' : 'ml-16'}`}>
          {/* Header */}
          <header className="bg-white border-b border-slate-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-800">
                  Net Worth: ${netWorth.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </h2>
                <p className="text-sm text-slate-500">Australian Dollar (AUD)</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-green-600 bg-green-50 px-3 py-1 rounded-full">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-sm font-medium">+2.4% this month</span>
                </div>
                <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-slate-600">JD</span>
                </div>
              </div>
            </div>
          </header>

          {/* Page Content */}
          <div className="p-6">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/portfolio" element={<Portfolio />} />
              <Route path="/performance" element={<Performance />} />
              <Route path="/cashflow" element={<CashFlow />} />
              <Route path="/advisor" element={<Advisor />} />
              <Route path="/ashare" element={<AShare />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/budgets" element={<Budgets />} />
              <Route path="/alerts" element={<Alerts />} />
            </Routes>
          </div>
        </main>
      </div>
    </Router>
  );
}

export default App;
