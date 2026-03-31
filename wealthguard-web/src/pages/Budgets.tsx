import React, { useState } from 'react';
import { Plus, Edit2, Trash2, AlertTriangle, CheckCircle, TrendingUp, X } from 'lucide-react';
import { usePersistentState, useToast } from '../hooks/usePersistentState';
import ToastContainer from '../components/ToastContainer';

const initialBudgets = [
  { id: 1, category: 'Groceries', budget: 1000, spent: 736, period: 'Monthly', alertAt: 80 },
  { id: 2, category: 'Food & Dining', budget: 800, spent: 0, period: 'Monthly', alertAt: 80 },
  { id: 3, category: 'Transportation', budget: 500, spent: 198, period: 'Monthly', alertAt: 80 },
  { id: 4, category: 'Software & Subscriptions', budget: 400, spent: 512, period: 'Monthly', alertAt: 80 },
  { id: 5, category: 'Shopping', budget: 600, spent: 245, period: 'Monthly', alertAt: 75 },
  { id: 6, category: 'Entertainment', budget: 300, spent: 0, period: 'Monthly', alertAt: 90 },
];

interface Budget {
  id: number;
  category: string;
  budget: number;
  spent: number;
  period: string;
  alertAt: number;
}

interface BudgetFormData {
  category: string;
  budget: string;
  alertAt: string;
  period: string;
}

const BudgetCard = ({ 
  budget, 
  onEdit, 
  onDelete 
}: { 
  budget: Budget; 
  onEdit: (b: Budget) => void;
  onDelete: (id: number) => void;
}) => {
  const percentage = (budget.spent / budget.budget) * 100;
  const isOver = percentage > 100;
  const isWarning = percentage >= budget.alertAt && !isOver;
  
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-slate-800">{budget.category}</h3>
          <p className="text-sm text-slate-500">{budget.period}</p>
        </div>
        <div className="flex items-center gap-2">
          {isOver && <AlertTriangle className="w-5 h-5 text-red-500" />}
          {isWarning && <AlertTriangle className="w-5 h-5 text-yellow-500" />}
          {!isOver && !isWarning && <CheckCircle className="w-5 h-5 text-green-500" />}
          
          <button 
            onClick={() => onEdit(budget)}
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600 transition-colors"
            title="Edit budget"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button 
            onClick={() => onDelete(budget.id)}
            className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600 transition-colors"
            title="Delete budget"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      <div className="mb-4">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-slate-600">Spent: ${budget.spent.toLocaleString()}</span>
          <span className={`font-medium ${isOver ? 'text-red-600' : 'text-slate-800'}`}>
            Budget: ${budget.budget.toLocaleString()}
          </span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isOver ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-green-500'
            }`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs mt-2">
          <span className={`${isOver ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
            {percentage.toFixed(0)}% used
          </span>
          <span className="text-slate-500">Alert at {budget.alertAt}%</span>
        </div>
      </div>
      
      {isOver && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">
            Over budget by ${(budget.spent - budget.budget).toLocaleString()}
          </p>
        </div>
      )}
      
      {isWarning && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-700">
            Approaching budget limit ({percentage.toFixed(0)}%)
          </p>
        </div>
      )}
    </div>
  );
};

const Budgets = () => {
  const [budgets, setBudgets] = usePersistentState<Budget[]>('wealthguard-budgets', initialBudgets);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<BudgetFormData>({
    category: '',
    budget: '',
    alertAt: '80',
    period: 'Monthly'
  });
  const { toasts, addToast, removeToast } = useToast();

  const totalBudget = budgets.reduce((sum, b) => sum + b.budget, 0);
  const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0);
  const totalRemaining = totalBudget - totalSpent;
  const overBudgetCount = budgets.filter(b => b.spent > b.budget).length;

  const handleAdd = () => {
    setEditingId(null);
    setFormData({ category: '', budget: '', alertAt: '80', period: 'Monthly' });
    setShowModal(true);
  };

  const handleEdit = (budget: Budget) => {
    setEditingId(budget.id);
    setFormData({
      category: budget.category,
      budget: budget.budget.toString(),
      alertAt: budget.alertAt.toString(),
      period: budget.period
    });
    setShowModal(true);
  };

  const handleDelete = (id: number) => {
    if (confirm('Are you sure you want to delete this budget?')) {
      setBudgets(prev => prev.filter(b => b.id !== id));
      addToast('Budget deleted', 'success');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const budgetAmount = parseFloat(formData.budget);
    const alertAt = parseInt(formData.alertAt);
    
    if (!formData.category || isNaN(budgetAmount) || budgetAmount <= 0) {
      addToast('Please fill in all fields correctly', 'error');
      return;
    }

    if (editingId) {
      setBudgets(prev => prev.map(b => 
        b.id === editingId 
          ? { ...b, category: formData.category, budget: budgetAmount, alertAt, period: formData.period }
          : b
      ));
      addToast('Budget updated', 'success');
    } else {
      const newId = Math.max(0, ...budgets.map(b => b.id)) + 1;
      setBudgets(prev => [...prev, {
        id: newId,
        category: formData.category,
        budget: budgetAmount,
        spent: 0,
        period: formData.period,
        alertAt
      }]);
      addToast('Budget created', 'success');
    }
    
    setShowModal(false);
  };

  const topSpending = [...budgets].sort((a, b) => b.spent - a.spent)[0];

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Total Budgets</p>
          <p className="text-2xl font-bold text-slate-800">{budgets.length}</p>
        </div>
        
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Total Budgeted</p>
          <p className="text-2xl font-bold text-slate-800">${totalBudget.toLocaleString()}</p>
        </div>
        
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Total Spent</p>
          <p className="text-2xl font-bold text-red-600">${totalSpent.toLocaleString()}</p>
        </div>
        
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <p className="text-sm text-slate-500">Remaining</p>
          <p className={`text-2xl font-bold ${totalRemaining >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            ${totalRemaining.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Add Budget Button */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-slate-800">Budget Categories</h2>
        <button 
          onClick={handleAdd}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Budget
        </button>
      </div>

      {/* Budget Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {budgets.map((budget) => (
          <BudgetCard 
            key={budget.id} 
            budget={budget} 
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {/* Insights */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl p-6 text-white">
        <div className="flex items-center gap-3 mb-4">
          <TrendingUp className="w-6 h-6" />
          <h3 className="text-lg font-semibold">Budget Insights</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-blue-100 text-sm mb-1">Top Spending Category</p>
            <p className="text-xl font-bold">{topSpending?.category || 'N/A'}</p>
            <p className="text-blue-100 text-sm">${topSpending?.spent.toLocaleString() || 0} spent</p>
          </div>
          
          <div>
            <p className="text-blue-100 text-sm mb-1">Over Budget</p>
            <p className="text-xl font-bold">{overBudgetCount} {overBudgetCount === 1 ? 'Category' : 'Categories'}</p>
            <p className="text-blue-100 text-sm">Need attention</p>
          </div>
          
          <div>
            <p className="text-blue-100 text-sm mb-1">Budget Utilization</p>
            <p className="text-xl font-bold">{totalBudget > 0 ? ((totalSpent / totalBudget) * 100).toFixed(1) : 0}%</p>
            <p className="text-blue-100 text-sm">Overall spent</p>
          </div>
        </div>
      </div>

      {/* Add/Edit Budget Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-800">
                {editingId ? 'Edit Budget' : 'Add New Budget'}
              </h3>
              <button 
                onClick={() => setShowModal(false)}
                className="p-1 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category Name *</label>
                <input 
                  type="text" 
                  value={formData.category}
                  onChange={(e) => setFormData({...formData, category: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Entertainment"
                  required
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Budget Amount *</label>
                  <input 
                    type="number" 
                    value={formData.budget}
                    onChange={(e) => setFormData({...formData, budget: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="500"
                    min="1"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Alert At (%)</label>
                  <input 
                    type="number" 
                    value={formData.alertAt}
                    onChange={(e) => setFormData({...formData, alertAt: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="80"
                    min="1"
                    max="100"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Period</label>
                <select
                  value={formData.period}
                  onChange={(e) => setFormData({...formData, period: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Weekly">Weekly</option>
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                  <option value="Yearly">Yearly</option>
                </select>
              </div>
              
              <div className="flex justify-end gap-3 pt-2">
                <button 
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {editingId ? 'Save Changes' : 'Add Budget'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Budgets;
