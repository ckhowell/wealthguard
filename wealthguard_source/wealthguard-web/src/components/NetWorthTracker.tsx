import { useState } from 'react';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Calendar, TrendingUp, Plus } from 'lucide-react';
import { usePersistentState } from '../hooks/usePersistentState';

interface NetWorthEntry {
  date: string;
  value: number;
  notes?: string;
}

interface NetWorthTrackerProps {
  currentNetWorth: number;
}

const NetWorthTracker = ({ currentNetWorth }: NetWorthTrackerProps) => {
  const [history, setHistory] = usePersistentState<NetWorthEntry[]>('wealthguard-networth-history', [
    { date: '2024-10-01', value: 3650000 },
    { date: '2024-11-01', value: 3685000 },
    { date: '2024-12-01', value: 3720000 },
    { date: '2025-01-01', value: 3755000 },
    { date: '2025-02-01', value: 3780000 },
    { date: '2025-03-01', value: currentNetWorth },
  ]);
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEntry, setNewEntry] = useState({ date: new Date().toISOString().split('T')[0], value: '', notes: '' });

  const handleAddEntry = () => {
    const value = parseFloat(newEntry.value);
    if (!value) return;
    
    const entry: NetWorthEntry = {
      date: newEntry.date,
      value,
      notes: newEntry.notes,
    };
    
    setHistory(prev => [...prev, entry].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
    setShowAddModal(false);
    setNewEntry({ date: new Date().toISOString().split('T')[0], value: '', notes: '' });
  };

  // Calculate growth
  const firstValue = history[0]?.value || 0;
  const lastValue = history[history.length - 1]?.value || 0;
  const totalGrowth = firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;
  const annualizedReturn = history.length > 1 
    ? (Math.pow(lastValue / firstValue, 12 / (history.length - 1)) - 1) * 100 
    : 0;

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            Net Worth History
          </h3>
          <p className="text-base text-stone-500 dark:text-stone-400">Track your wealth over time</p>
        </div>
        
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1 px-3 py-1.5 bg-cyan-500 text-white rounded-lg text-base hover:bg-cyan-600"
        >
          <Plus className="w-4 h-4" />
          Add Entry
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="p-3 bg-stone-50 dark:bg-stone-800 rounded-lg text-center">
          <p className="text-xs text-stone-500 dark:text-stone-400">Total Growth</p>
          <p className={`text-xl font-bold ${totalGrowth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {totalGrowth >= 0 ? '+' : ''}{totalGrowth.toFixed(1)}%
          </p>
        </div>
        <div className="p-3 bg-stone-50 dark:bg-stone-800 rounded-lg text-center">
          <p className="text-xs text-stone-500 dark:text-stone-400">Annualized</p>
          <p className={`text-xl font-bold ${annualizedReturn >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {annualizedReturn >= 0 ? '+' : ''}{annualizedReturn.toFixed(1)}%
          </p>
        </div>
        <div className="p-3 bg-stone-50 dark:bg-stone-800 rounded-lg text-center">
          <p className="text-xs text-stone-500 dark:text-stone-400">Entries</p>
          <p className="text-xl font-bold text-stone-800 dark:text-stone-100">{history.length}</p>
        </div>
      </div>

      {/* Chart */}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis 
              dataKey="date" 
              stroke="#64748b"
              tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
            />
            <YAxis 
              stroke="#64748b"
              tickFormatter={(value) => `$${(value / 1000000).toFixed(1)}M`}
            />
            <Tooltip 
              formatter={(value) => typeof value === 'number' ? `$${value.toLocaleString()}` : value}
              labelFormatter={(label) => new Date(label).toLocaleDateString()}
            />
            <Line 
              type="monotone" 
              dataKey="value" 
              stroke="#3b82f6" 
              strokeWidth={2}
              dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Entries */}
      <div className="mt-4">
        <p className="text-base text-stone-700 dark:text-stone-200 mb-2">Recent Entries</p>
        <div className="space-y-1">
          {history.slice(-3).reverse().map((entry, i) => (
            <div key={i} className="flex items-center justify-between p-2 bg-stone-50 dark:bg-stone-800 rounded">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                <span className="text-base text-stone-600 dark:text-stone-400">
                  {new Date(entry.date).toLocaleDateString()}
                </span>
              </div>
              <span className="text-stone-800 dark:text-stone-100">${entry.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Add Entry Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-stone-900 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-4">Add Net Worth Entry</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-base text-stone-600 dark:text-stone-400 mb-1">Date</label>
                <input
                  type="date"
                  value={newEntry.date}
                  onChange={(e) => setNewEntry({ ...newEntry, date: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              
              <div>
                <label className="block text-base text-stone-600 dark:text-stone-300 mb-1">Net Worth (AUD)</label>
                <input
                  type="number"
                  value={newEntry.value}
                  onChange={(e) => setNewEntry({ ...newEntry, value: e.target.value })}
                  placeholder="e.g. 4000000"
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              
              <div>
                <label className="block text-base text-stone-600 dark:text-stone-300 mb-1">Notes (optional)</label>
                <input
                  type="text"
                  value={newEntry.notes}
                  onChange={(e) => setNewEntry({ ...newEntry, notes: e.target.value })}
                  placeholder="e.g. Property valuation update"
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:ring-2 focus:ring-cyan-500"
                />
              </div>
            </div>
            
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2 border border-stone-200 dark:border-stone-800 rounded-lg text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:bg-stone-800 dark:hover:bg-stone-800"
              >
                Cancel
              </button>
              <button
                onClick={handleAddEntry}
                className="flex-1 px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600"
              >
                Add Entry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NetWorthTracker;
