import { useState } from 'react';
import { 
  Bell, CheckCircle, AlertTriangle, XCircle, Info,
  Settings, Trash2, ChevronDown, ChevronUp, Archive,
  MailOpen, Search, X
} from 'lucide-react';
import { usePersistentState, useToast } from '../hooks/usePersistentState';
import ToastContainer from '../components/ToastContainer';

const initialAlerts = [
  {
    id: 1,
    type: 'warning',
    title: 'Budget Overrun',
    message: 'Software & Subscriptions budget is 128% over. Current: $512, Budget: $400',
    timestamp: new Date().toISOString(),
    read: false,
    category: 'Budget'
  },
  {
    id: 2,
    type: 'success',
    title: 'Portfolio Update Complete',
    message: 'Daily portfolio valuation completed. Net worth: $3,828,255.31',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    read: true,
    category: 'Portfolio'
  },
  {
    id: 3,
    type: 'info',
    title: 'FX Rate Alert',
    message: 'JPY/AUD rate is healthy at 0.009117 (above 0.0090 threshold)',
    timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    read: true,
    category: 'FX'
  },
  {
    id: 4,
    type: 'warning',
    title: 'High Crypto Concentration',
    message: 'Your crypto allocation is 14.6% of total portfolio. Consider rebalancing if risk tolerance changes.',
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    read: false,
    category: 'Portfolio'
  },
  {
    id: 5,
    type: 'success',
    title: 'Interest Payment Received',
    message: 'Premium Bonus Interest of $2,084.52 credited to Rabobank PremiumSaver',
    timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    read: true,
    category: 'Income'
  },
  {
    id: 6,
    type: 'info',
    title: 'Stock Concentration Alert',
    message: 'NVDA represents 54.9% of your stock portfolio. Monitor for diversification.',
    timestamp: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
    read: false,
    category: 'Portfolio'
  },
];

const alertRules = [
  { id: 1, name: 'Budget Overrun', condition: 'Spending > 100% of budget', active: true },
  { id: 2, name: 'Budget Warning', condition: 'Spending > 80% of budget', active: true },
  { id: 3, name: 'Portfolio Drop', condition: 'Daily drop > 2%', active: true },
  { id: 4, name: 'FX Rate Alert', condition: 'JPY/AUD < 0.0090', active: true },
  { id: 5, name: 'High Concentration', condition: 'Single asset > 30%', active: false },
];

const AlertIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'success':
      return <CheckCircle className="w-5 h-5 text-green-500" />;
    case 'warning':
      return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
    case 'error':
      return <XCircle className="w-5 h-5 text-red-500" />;
    default:
      return <Info className="w-5 h-5 text-blue-500" />;
  }
};

const AlertBadge = ({ type }: { type: string }) => {
  const styles = {
    success: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    error: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800',
  };
  
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[type as keyof typeof styles]}`}>
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </span>
  );
};

const Alerts = () => {
  const [alerts, setAlerts] = usePersistentState('wealthguard-alerts', initialAlerts);
  const [activeTab, setActiveTab] = useState('all');
  const [showRules, setShowRules] = useState(false);
  const [expandedAlert, setExpandedAlert] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAlerts, setSelectedAlerts] = useState<number[]>([]);
  const { toasts, addToast, removeToast } = useToast();

  const filteredAlerts = alerts.filter(alert => {
    const matchesTab = activeTab === 'all' 
      ? true 
      : activeTab === 'unread' 
      ? !alert.read 
      : alert.type === activeTab;
    
    const matchesSearch = searchQuery === '' ||
      alert.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      alert.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      alert.category.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesTab && matchesSearch;
  });

  const unreadCount = alerts.filter(a => !a.read).length;

  const handleDelete = (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setAlerts(prev => prev.filter(a => a.id !== id));
    addToast('Alert deleted', 'success');
  };

  const handleDeleteSelected = () => {
    if (selectedAlerts.length === 0) return;
    setAlerts(prev => prev.filter(a => !selectedAlerts.includes(a.id)));
    addToast(`${selectedAlerts.length} alerts deleted`, 'success');
    setSelectedAlerts([]);
  };

  const handleMarkAsRead = (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setAlerts(prev => prev.map(a => 
      a.id === id ? { ...a, read: true } : a
    ));
    addToast('Marked as read', 'info');
  };

  const handleMarkAllAsRead = () => {
    setAlerts(prev => prev.map(a => ({ ...a, read: true })));
    addToast('All alerts marked as read', 'success');
  };

  const handleArchiveAllRead = () => {
    const readCount = alerts.filter(a => a.read).length;
    if (readCount === 0) {
      addToast('No read alerts to archive', 'info');
      return;
    }
    setAlerts(prev => prev.filter(a => !a.read));
    addToast(`${readCount} read alerts archived`, 'success');
  };

  const toggleSelect = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAlerts(prev => 
      prev.includes(id) 
        ? prev.filter(i => i !== id)
        : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedAlerts.length === filteredAlerts.length) {
      setSelectedAlerts([]);
    } else {
      setSelectedAlerts(filteredAlerts.map(a => a.id));
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Bell className="w-8 h-8 text-slate-700" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Alerts & Notifications</h2>
            <p className="text-slate-500">{unreadCount} unread notifications</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button 
              onClick={handleMarkAllAsRead}
              className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
            >
              <MailOpen className="w-4 h-4" />
              Mark all read
            </button>
          )}
          <button 
            onClick={() => setShowRules(!showRules)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <Settings className="w-4 h-4" />
            Alert Rules
            {showRules ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Alert Rules Panel */}
      {showRules && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Active Alert Rules</h3>
          <div className="space-y-3">
            {alertRules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div>
                  <p className="font-medium text-slate-800">{rule.name}</p>
                  <p className="text-sm text-slate-500">{rule.condition}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm ${rule.active ? 'text-green-600' : 'text-slate-400'}`}>
                    {rule.active ? 'Active' : 'Disabled'}
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" defaultChecked={rule.active} className="sr-only peer" />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search alerts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              <X className="w-4 h-4 text-slate-400 hover:text-slate-600" />
            </button>
          )}
        </div>
        
        <button
          onClick={handleArchiveAllRead}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
          disabled={alerts.filter(a => a.read).length === 0}
        >
          <Archive className="w-4 h-4" />
          Archive Read
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'all', label: 'All', count: alerts.length },
          { id: 'unread', label: 'Unread', count: unreadCount },
          { id: 'warning', label: 'Warnings', count: alerts.filter(a => a.type === 'warning').length },
          { id: 'success', label: 'Success', count: alerts.filter(a => a.type === 'success').length },
          { id: 'info', label: 'Info', count: alerts.filter(a => a.type === 'info').length },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                activeTab === tab.id ? 'bg-blue-500' : 'bg-slate-200'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Bulk Actions */}
      {selectedAlerts.length > 0 && (
        <div className="flex items-center gap-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm text-blue-800 font-medium">{selectedAlerts.length} selected</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
            <button
              onClick={() => setSelectedAlerts([])}
              className="px-3 py-1.5 text-blue-600 text-sm hover:bg-blue-100 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Alerts List */}
      <div className="space-y-3">
        {filteredAlerts.length > 0 && (
          <div className="flex items-center gap-2 px-2">
            <input
              type="checkbox"
              checked={selectedAlerts.length === filteredAlerts.length && filteredAlerts.length > 0}
              onChange={selectAll}
              className="w-4 h-4 rounded border-slate-300"
            />
            <span className="text-sm text-slate-500">Select all</span>
          </div>
        )}
        
        {filteredAlerts.map((alert) => (
          <div
            key={alert.id}
            onClick={() => setExpandedAlert(expandedAlert === alert.id ? null : alert.id)}
            className={`bg-white rounded-xl shadow-sm border transition-all cursor-pointer hover:shadow-md ${
              alert.read ? 'border-slate-200' : 'border-blue-300 bg-blue-50/30'
            } ${selectedAlerts.includes(alert.id) ? 'ring-2 ring-blue-500' : ''}`}
          >
            <div className="p-6">
              <div className="flex items-start gap-4">
                <input
                  type="checkbox"
                  checked={selectedAlerts.includes(alert.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => toggleSelect(alert.id, e as any)}
                  className="w-4 h-4 mt-1 rounded border-slate-300"
                />
                
                <AlertIcon type={alert.type} />
                
                <div className="flex-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className={`font-semibold ${alert.read ? 'text-slate-800' : 'text-slate-900'}`}>
                        {alert.title}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <AlertBadge type={alert.type} />
                        <span className="text-sm text-slate-500">{alert.category}</span>
                        <span className="text-sm text-slate-400">• {formatTime(alert.timestamp)}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1">
                      {!alert.read && (
                        <button 
                          onClick={(e) => handleMarkAsRead(alert.id, e)}
                          className="p-2 hover:bg-blue-100 rounded-lg text-blue-600"
                          title="Mark as read"
                        >
                          <MailOpen className="w-4 h-4" />
                        </button>
                      )}
                      <button 
                        onClick={(e) => handleDelete(alert.id, e)}
                        className="p-2 hover:bg-red-50 rounded-lg group"
                        title="Delete alert"
                      >
                        <Trash2 className="w-4 h-4 text-slate-400 group-hover:text-red-500" />
                      </button>
                    </div>
                  </div>
                  
                  <p className="mt-2 text-slate-600">{alert.message}</p>
                  
                  {!alert.read && (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
                      <span className="text-sm text-blue-600 font-medium">Unread</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
        
        {filteredAlerts.length === 0 && (
          <div className="text-center py-12">
            <Bell className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500">{searchQuery ? 'No alerts match your search' : 'No alerts found'}</p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="mt-2 text-blue-600 hover:underline"
              >
                Clear search
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Alerts;
