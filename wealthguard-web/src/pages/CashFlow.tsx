import { useState, useMemo } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from 'recharts';
import { 
  Wallet, TrendingUp, 
  Calendar, PiggyBank, Target, AlertTriangle
} from 'lucide-react';
import { usePersistentState } from '../hooks/usePersistentState';

interface CashFlowItem {
  month: string;
  income: number;
  expenses: number;
  investments: number;
  netFlow: number;
  cumulative: number;
}

// Generate 12-month forecast
const generateCashFlowForecast = (): CashFlowItem[] => {
  const data: CashFlowItem[] = [];
  const now = new Date();
  let cumulative = 580000; // Starting cash position
  
  // Monthly patterns
  const baseIncome = 15000; // Monthly income
  const baseExpenses = 8500; // Monthly expenses
  const baseInvestments = 5000; // Monthly investments
  
  for (let i = 0; i < 12; i++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + i);
    
    // Add some variation
    const income = baseIncome + (Math.random() - 0.5) * 2000;
    const expenses = baseExpenses + (Math.random() - 0.5) * 1000;
    const investments = i < 3 ? 0 : baseInvestments; // No investments first 3 months
    
    const netFlow = income - expenses - investments;
    cumulative += netFlow;
    
    data.push({
      month: d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' }),
      income: Math.round(income),
      expenses: Math.round(expenses),
      investments: Math.round(investments),
      netFlow: Math.round(netFlow),
      cumulative: Math.round(cumulative),
    });
  }
  
  return data;
};

interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  monthlyContribution: number;
}

const defaultGoals: Goal[] = [
  {
    id: '1',
    name: 'Niseko Property Upgrade',
    targetAmount: 50000,
    currentAmount: 15000,
    deadline: '2026-12-01',
    monthlyContribution: 3000,
  },
  {
    id: '2',
    name: 'Emergency Fund (6 months)',
    targetAmount: 100000,
    currentAmount: 85000,
    deadline: '2026-08-01',
    monthlyContribution: 2500,
  },
  {
    id: '3',
    name: 'ASX Portfolio Build',
    targetAmount: 200000,
    currentAmount: 4300,
    deadline: '2027-06-01',
    monthlyContribution: 10000,
  },
];

const CashFlowPage = () => {
  const [forecastData] = useState(() => generateCashFlowForecast());
  const [goals] = usePersistentState<Goal[]>('cashflow-goals', defaultGoals);
  
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };
  
  const summary = useMemo(() => {
    const totalIncome = forecastData.reduce((sum, d) => sum + d.income, 0);
    const totalExpenses = forecastData.reduce((sum, d) => sum + d.expenses, 0);
    const totalInvestments = forecastData.reduce((sum, d) => sum + d.investments, 0);
    const endingCash = forecastData[forecastData.length - 1]?.cumulative || 0;
    const avgMonthlyFlow = (totalIncome - totalExpenses - totalInvestments) / 12;
    
    return {
      totalIncome,
      totalExpenses,
      totalInvestments,
      endingCash,
      avgMonthlyFlow,
    };
  }, [forecastData]);
  
  const projectedRunway = useMemo(() => {
    const avgExpense = summary.totalExpenses / 12;
    if (avgExpense <= 0) return Infinity;
    return Math.round(summary.endingCash / avgExpense);
  }, [summary]);
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl p-6 text-white">
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="w-6 h-6" />
          <h1 className="text-2xl font-bold">Cash Flow Forecast</h1>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white/10 rounded-lg px-4 py-3">
            <p className="text-sm text-emerald-100">Projected 12M Cash</p>
            <p className="text-2xl font-bold">{formatCurrency(summary.endingCash)}</p>
          </div>
          
          <div className="bg-white/10 rounded-lg px-4 py-3">
            <p className="text-sm text-emerald-100">Avg Monthly Flow</p>
            <p className={`text-2xl font-bold ${summary.avgMonthlyFlow >= 0 ? '' : 'text-red-300'}`}>
              {summary.avgMonthlyFlow >= 0 ? '+' : ''}{formatCurrency(summary.avgMonthlyFlow)}
            </p>
          </div>
          
          <div className="bg-white/10 rounded-lg px-4 py-3">
            <p className="text-sm text-emerald-100">Runway (Months)</p>
            <p className="text-2xl font-bold">{projectedRunway === Infinity ? '∞' : projectedRunway}</p>
          </div>
          
          <div className="bg-white/10 rounded-lg px-4 py-3">
            <p className="text-sm text-emerald-100">Investments (12M)</p>
            <p className="text-2xl font-bold">{formatCurrency(summary.totalInvestments)}</p>
          </div>
        </div>
      </div>
      
      {/* Monthly Cash Flow Chart */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">12-Month Cash Flow Projection</h2>
        
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={forecastData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#64748b" />
              <YAxis tick={{ fontSize: 12 }} stroke="#64748b" tickFormatter={(v) => `$${v/1000}k`} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                formatter={(value) => formatCurrency(Number(value))}
              />
              <Legend />
              <Bar dataKey="income" name="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Bar dataKey="investments" name="Investments" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>      
      </div>
      
      {/* Cumulative Cash Position */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Cumulative Cash Position</h2>
        
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={forecastData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#64748b" />
              <YAxis tick={{ fontSize: 12 }} stroke="#64748b" tickFormatter={(v) => `$${v/1000}k`} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                formatter={(value) => formatCurrency(Number(value))}
              />
              <Area 
                type="monotone" 
                dataKey="cumulative" 
                name="Cash Balance" 
                stroke="#10b981" 
                fill="#10b981" 
                fillOpacity={0.2}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>      
      </div>
      
      {/* Savings Goals */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Savings Goals</h2>
          </div>
        </div>
        
        <div className="space-y-4">
          {goals.map((goal) => {
            const progress = (goal.currentAmount / goal.targetAmount) * 100;
            const remaining = goal.targetAmount - goal.currentAmount;
            const monthsUntilDeadline = Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30));
            const requiredMonthly = remaining / monthsUntilDeadline;
            const onTrack = goal.monthlyContribution >= requiredMonthly;
            
            return (
              <div key={goal.id} className="p-4 bg-slate-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-slate-800">{goal.name}</h3>
                  <span className="text-sm text-slate-500">{progress.toFixed(0)}%</span>
                </div>
                
                <div className="w-full bg-slate-200 rounded-full h-2 mb-3">
                  <div 
                    className="bg-emerald-500 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <div className="text-slate-600">
                    <span className="font-medium">{formatCurrency(goal.currentAmount)}</span>
                    {' '}of {formatCurrency(goal.targetAmount)}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {!onTrack && (
                      <span className="flex items-center gap-1 text-amber-600">
                        <AlertTriangle className="w-4 h-4" />
                        Need {formatCurrency(requiredMonthly)}/mo
                      </span>
                    )}
                    <span className={`${onTrack ? 'text-emerald-600' : 'text-slate-500'}`}>
                      Due {new Date(goal.deadline).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Investment Deployment Plan */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <PiggyBank className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-800">Cash Deployment Strategy</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-emerald-600" />
              <h3 className="font-medium text-emerald-800">Month 1-3: Preserve</h3>
            </div>
            <p className="text-sm text-emerald-700 mb-2">Keep cash in Rabobank at 5.15%</p>
            <ul className="text-xs text-emerald-600 space-y-1">
              <li>• Monitor market conditions</li>
              <li>• Complete emergency fund</li>
              <li>• Research ASX opportunities</li>
            </ul>
          </div>
          
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <h3 className="font-medium text-blue-800">Month 4-8: Deploy</h3>
            </div>
            <p className="text-sm text-blue-700 mb-2">Begin DCA into ASX positions</p>
            <ul className="text-xs text-blue-600 space-y-1">
              <li>• $10k/month into ANZ/RIO/TCL</li>
              <li>• $5k/month into VAS ETF</li>
              <li>• Maintain $200k cash buffer</li>
            </ul>
          </div>
          
          <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-purple-600" />
              <h3 className="font-medium text-purple-800">Month 9-12: Optimize</h3>
            </div>
            <p className="text-sm text-purple-700 mb-2">Rebalance and diversify</p>
            <ul className="text-xs text-purple-600 space-y-1">
              <li>• Review crypto positions</li>
              <li>• Consider international exposure</li>
              <li>• Tax-loss harvesting review</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CashFlowPage;
