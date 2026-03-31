import { useState } from 'react';
import { Search, Download, ArrowUpRight, ArrowDownRight } from 'lucide-react';

// Mock transaction data
const transactions = [
  { id: 1, date: '2026-03-28', account: 'Rabobank PremiumSaver', description: 'Premium Bonus Interest', category: 'Income - Interest', amount: 2084.52, type: 'credit' },
  { id: 2, date: '2026-03-26', account: 'ANZ Credit Card', description: 'AMAZON AU', category: 'Shopping', amount: 127.50, type: 'debit' },
  { id: 3, date: '2026-03-25', account: 'Rabobank PremiumSaver', description: 'Transfer from A/c 367029558', category: 'Transfer', amount: 5000.00, type: 'credit' },
  { id: 4, date: '2026-03-24', account: 'ANZ Credit Card', description: 'WOOLWORTHS', category: 'Groceries', amount: 156.80, type: 'debit' },
  { id: 5, date: '2026-03-23', account: 'WISE JPY', description: 'Currency Conversion', category: 'FX', amount: 2500.00, type: 'credit' },
  { id: 6, date: '2026-03-22', account: 'ANZ Credit Card', description: 'SHELL', category: 'Transportation', amount: 85.40, type: 'debit' },
  { id: 7, date: '2026-03-21', account: 'Rabobank PremiumSaver', description: 'Credit Interest', category: 'Income - Interest', amount: 450.00, type: 'credit' },
  { id: 8, date: '2026-03-20', account: 'ANZ Credit Card', description: 'COLES', category: 'Groceries', amount: 98.60, type: 'debit' },
  { id: 9, date: '2026-03-19', account: 'ANZ Credit Card', description: 'NETFLIX', category: 'Software & Subscriptions', amount: 19.99, type: 'debit' },
  { id: 10, date: '2026-03-18', account: 'ANZ Credit Card', description: 'SPOTIFY', category: 'Software & Subscriptions', amount: 14.99, type: 'debit' },
];

const categories = ['All', 'Income - Interest', 'Groceries', 'Shopping', 'Transportation', 'Software & Subscriptions', 'Transfer', 'FX'];
const accounts = ['All', 'Rabobank PremiumSaver', 'ANZ Credit Card', 'WISE JPY'];

const Transactions = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedAccount, setSelectedAccount] = useState('All');

  const filteredTransactions = transactions.filter(t => {
    const matchesSearch = t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         t.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || t.category === selectedCategory;
    const matchesAccount = selectedAccount === 'All' || t.account === selectedAccount;
    return matchesSearch && matchesCategory && matchesAccount;
  });

  const totalCredits = filteredTransactions
    .filter(t => t.type === 'credit')
    .reduce((sum, t) => sum + t.amount, 0);
  
  const totalDebits = filteredTransactions
    .filter(t => t.type === 'debit')
    .reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Total Transactions</p>
          <p className="text-2xl font-bold text-slate-800">{filteredTransactions.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Total Credits</p>
          <p className="text-2xl font-bold text-green-600">+${totalCredits.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Total Debits</p>
          <p className="text-2xl font-bold text-red-600">-${totalDebits.toLocaleString()}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search transactions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {accounts.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          
          <button className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left py-4 px-6 text-sm font-medium text-slate-500">Date</th>
                <th className="text-left py-4 px-6 text-sm font-medium text-slate-500">Account</th>
                <th className="text-left py-4 px-6 text-sm font-medium text-slate-500">Description</th>
                <th className="text-left py-4 px-6 text-sm font-medium text-slate-500">Category</th>
                <th className="text-right py-4 px-6 text-sm font-medium text-slate-500">Amount</th>
                <th className="text-center py-4 px-6 text-sm font-medium text-slate-500">Type</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="py-4 px-6 text-sm text-slate-600">{t.date}</td>
                  <td className="py-4 px-6 text-sm text-slate-800">{t.account}</td>
                  <td className="py-4 px-6 text-sm font-medium text-slate-800">{t.description}</td>
                  <td className="py-4 px-6">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                      {t.category}
                    </span>
                  </td>
                  <td className={`py-4 px-6 text-sm font-bold text-right ${
                    t.type === 'credit' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {t.type === 'credit' ? '+' : '-'}${t.amount.toLocaleString()}
                  </td>
                  <td className="py-4 px-6 text-center">
                    {t.type === 'credit' ? (
                      <span className="inline-flex items-center gap-1 text-green-600 text-sm">
                        <ArrowUpRight className="w-4 h-4" /> Credit
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-red-600 text-sm">
                        <ArrowDownRight className="w-4 h-4" /> Debit
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filteredTransactions.length === 0 && (
          <div className="py-12 text-center text-slate-500">
            <p>No transactions found matching your filters.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Transactions;
