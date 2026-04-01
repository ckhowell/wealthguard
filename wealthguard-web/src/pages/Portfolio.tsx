import { useState, useEffect, useMemo } from 'react';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { 
  ArrowUpRight, ArrowDownRight, Building2, Car, Bitcoin, LineChart,
  Plus, Edit2, Trash2, X, Wallet, Home
} from 'lucide-react';
import { usePersistentState, useToast } from '../hooks/usePersistentState';
import ToastContainer from '../components/ToastContainer';
import RiskAnalysis from '../components/RiskAnalysis';

interface RealEstate {
  id: number;
  name: string;
  value: number;
  location: string;
  type: 'realEstate';
  purchaseDate?: string;
  notes?: string;
}

interface Crypto {
  id: number;
  symbol: string;
  name: string;
  units: number;
  value: number;
  change: number;
  type: 'crypto';
  avgBuyPrice?: number;
}

interface Vehicle {
  id: number;
  name: string;
  value: number;
  vehicleType: string;
  type: 'vehicle';
  year?: number;
}

interface Stock {
  id: number;
  symbol: string;
  name: string;
  units: number;
  value: number;
  weight: number;
  type: 'stock';
  avgBuyPrice?: number;
}

interface Cash {
  id: number;
  name: string;
  value: number;
  institution: string;
  type: 'cash';
  apy?: number;
}

type Holding = RealEstate | Crypto | Vehicle | Stock | Cash;

const initialHoldings: Holding[] = [
  // Real Estate
  { id: 1, name: 'Southport QLD Property', value: 1100000, location: 'Australia', type: 'realEstate', purchaseDate: '2020-03-15' },
  { id: 2, name: 'Niseko Japan Property', value: 501435, location: 'Japan', type: 'realEstate', purchaseDate: '2019-06-20' },
  { id: 3, name: 'Ansons Bay TAS (143-145)', value: 470000, location: 'Australia', type: 'realEstate', purchaseDate: '2021-01-10' },
  { id: 4, name: 'Ansons Bay TAS (18)', value: 420000, location: 'Australia', type: 'realEstate', purchaseDate: '2021-01-10' },
  // Cash - Two Rabo accounts, one Wise account (from user's actual bank data)
  { id: 5, name: 'Rabobank PremiumSaver', value: 380357, institution: 'Rabobank', type: 'cash', apy: 9.52 },
  { id: 6, name: 'Rabobank High Interest', value: 150000, institution: 'Rabobank', type: 'cash', apy: 5.75 },
  { id: 7, name: 'Wise JPY Account', value: 50000, institution: 'Wise', type: 'cash', apy: 0 },
  // Crypto
  { id: 8, symbol: 'BTC', name: 'Bitcoin', units: 2.81, value: 302509, change: 5.2, type: 'crypto', avgBuyPrice: 45000 },
  { id: 9, symbol: 'ETH', name: 'Ethereum', units: 64, value: 208631, change: 3.8, type: 'crypto', avgBuyPrice: 1800 },
  { id: 10, symbol: 'SOL', name: 'Solana', units: 270, value: 36894, change: -2.1, type: 'crypto', avgBuyPrice: 85 },
  { id: 11, symbol: 'XRP', name: 'Ripple', units: 2303, value: 4889, change: 1.2, type: 'crypto', avgBuyPrice: 1.2 },
  { id: 12, symbol: 'SUI', name: 'Sui', units: 901, value: 4713, change: 8.5, type: 'crypto', avgBuyPrice: 3.5 },
  // Vehicles
  { id: 13, name: 'Land Rover 2023 Defender', value: 100000, vehicleType: '4WD', type: 'vehicle', year: 2023 },
  { id: 14, name: 'VW 2024 GTi Golf', value: 55000, vehicleType: 'Hatchback', type: 'vehicle', year: 2024 },
  { id: 15, name: 'Land Rover 2011 Defender', value: 20000, vehicleType: '4WD', type: 'vehicle', year: 2011 },
  { id: 16, name: 'Triumph T120 2023', value: 17000, vehicleType: 'Motorcycle', type: 'vehicle', year: 2023 },
  { id: 17, name: 'Trailer', value: 2500, vehicleType: 'Utility', type: 'vehicle', year: 2020 },
  // Stocks
  { id: 18, symbol: 'NVDA', name: 'NVIDIA', units: 9.56, value: 2375.95, weight: 54.9, type: 'stock', avgBuyPrice: 120 },
  { id: 19, symbol: 'XLE', name: 'Energy ETF', units: 12.26, value: 1094.80, weight: 25.3, type: 'stock', avgBuyPrice: 75 },
  { id: 20, symbol: 'AAPL', name: 'Apple', units: 1.18, value: 431.73, weight: 10.0, type: 'stock', avgBuyPrice: 180 },
  { id: 21, symbol: 'GOOGL', name: 'Alphabet', units: 1.02, value: 416.92, weight: 9.6, type: 'stock', avgBuyPrice: 140 },
  { id: 22, symbol: 'GPRO', name: 'GoPro', units: 7, value: 6.82, weight: 0.2, type: 'stock', avgBuyPrice: 8 },
];

const categoryColors: Record<string, string> = {
  realEstate: '#3b82f6',
  cash: '#10b981',
  crypto: '#f59e0b',
  vehicle: '#8b5cf6',
  stock: '#ef4444',
};

const Portfolio = () => {
  const [holdings, setHoldings] = usePersistentState<Holding[]>('wealthguard-holdings', initialHoldings);
  const [apiHoldings, setApiHoldings] = useState<any[]>([]);
  const [_loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_activeTab, _setActiveTab] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [holdingType, setHoldingType] = useState<string>('stock');
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const { toasts, addToast, removeToast } = useToast();

  // Fetch holdings from database API
  useEffect(() => {
    const fetchApiHoldings = async () => {
      try {
        const response = await fetch('/api/holdings');
        if (response.ok) {
          const data = await response.json();
          // API returns array directly, not {holdings: [...]}
          setApiHoldings(Array.isArray(data) ? data : (data.holdings || []));
        }
      } catch (err) {
        console.error('Failed to fetch holdings:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchApiHoldings();
  }, []);

  // Merge API holdings with local stocks (prioritize API data for stocks)
  const mergedHoldings = useMemo(() => {
    if (apiHoldings.length === 0) return holdings;
    
    // Create map of API stock holdings
    const apiStockMap = new Map();
    apiHoldings.forEach((h: any) => {
      if (h.asset_class === 'equity') {
        apiStockMap.set(h.symbol, h);
      }
    });
    
    // Update local holdings with API data
    return holdings.map(h => {
      if (h.type === 'stock') {
        const apiData = apiStockMap.get((h as Stock).symbol);
        if (apiData) {
          return {
            ...h,
            units: apiData.shares || (h as Stock).units,
            value: (apiData.shares || 0) * (apiData.current_price || 0)
          };
        }
      }
      return h;
    });
  }, [holdings, apiHoldings]);

  // Fetch live stock prices from API
  useEffect(() => {
    const fetchLivePrices = async () => {
      try {
        // Get stock symbols from holdings
        const stockSymbols = holdings
          .filter(h => h.type === 'stock')
          .map(h => (h as Stock).symbol);
        
        if (stockSymbols.length === 0) return;
        
        // Fetch from API for each symbol
        const priceMap: Record<string, number> = {};
        
        await Promise.all(
          stockSymbols.map(async (symbol) => {
            try {
              const response = await fetch(`/api/markets/US`);
              if (response.ok) {
                const data = await response.json();
                const stockData = data.stocks?.find((s: any) => s.symbol === symbol);
                if (stockData?.price) {
                  priceMap[symbol] = stockData.price;
                }
              }
            } catch (err) {
              console.error(`Failed to fetch price for ${symbol}:`, err);
            }
          })
        );
        
        setLivePrices(priceMap);
      } catch (err) {
        console.error('Failed to fetch live prices:', err);
      }
    };
    
    fetchLivePrices();
    // Refresh every 5 minutes
    const interval = setInterval(fetchLivePrices, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [holdings]);

  // Update stock values based on live prices
  useEffect(() => {
    if (Object.keys(livePrices).length === 0) return;
    
    setHoldings(prev => prev.map(holding => {
      if (holding.type === 'stock') {
        const stock = holding as Stock;
        const livePrice = livePrices[stock.symbol];
        if (livePrice) {
          return {
            ...stock,
            value: stock.units * livePrice
          };
        }
      }
      return holding;
    }));
  }, [livePrices, setHoldings]);

  // Form states
  const [formData, setFormData] = useState<Record<string, any>>({});

  const realEstateHoldings = mergedHoldings.filter(h => h.type === 'realEstate') as RealEstate[];
  const cryptoHoldings = mergedHoldings.filter(h => h.type === 'crypto') as Crypto[];
  const vehicleHoldings = mergedHoldings.filter(h => h.type === 'vehicle') as Vehicle[];
  const stockHoldings = mergedHoldings.filter(h => h.type === 'stock') as Stock[];
  const cashHoldings = mergedHoldings.filter(h => h.type === 'cash') as Cash[];

  const totals = {
    realEstate: realEstateHoldings.reduce((sum, h) => sum + h.value, 0),
    cash: cashHoldings.reduce((sum, h) => sum + h.value, 0),
    crypto: cryptoHoldings.reduce((sum, h) => sum + h.value, 0),
    vehicle: vehicleHoldings.reduce((sum, h) => sum + h.value, 0),
    stock: stockHoldings.reduce((sum, h) => sum + h.value, 0),
  };

  const totalValue = Object.values(totals).reduce((sum, val) => sum + val, 0);

  const categoryData = [
    { name: 'Real Estate', value: totals.realEstate, color: categoryColors.realEstate },
    { name: 'Cash', value: totals.cash, color: categoryColors.cash },
    { name: 'Crypto', value: totals.crypto, color: categoryColors.crypto },
    { name: 'Vehicles', value: totals.vehicle, color: categoryColors.vehicle },
    { name: 'Stocks', value: totals.stock, color: categoryColors.stock },
  ].filter(c => c.value > 0);

  const handleAdd = (type: string) => {
    setHoldingType(type);
    setEditingId(null);
    setFormData({});
    setShowModal(true);
  };

  const handleEdit = (holding: Holding) => {
    setHoldingType(holding.type);
    setEditingId(holding.id);
    setFormData({ ...holding });
    setShowModal(true);
  };

  const handleDelete = (id: number) => {
    if (confirm('Are you sure you want to delete this holding?')) {
      setHoldings(prev => prev.filter(h => h.id !== id));
      addToast('Holding deleted', 'success');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const baseData: Record<string, any> = {
      id: editingId || Math.max(0, ...holdings.map(h => h.id)) + 1,
      type: holdingType,
      ...formData,
    };

    // Convert numeric fields
    if (formData.value) baseData.value = parseFloat(formData.value);
    if (formData.units) baseData.units = parseFloat(formData.units);
    if (formData.change) baseData.change = parseFloat(formData.change);
    if (formData.weight) baseData.weight = parseFloat(formData.weight);
    if (formData.year) baseData.year = parseInt(formData.year);
    if (formData.apy) baseData.apy = parseFloat(formData.apy);
    if (formData.avgBuyPrice) baseData.avgBuyPrice = parseFloat(formData.avgBuyPrice);

    if (editingId) {
      setHoldings(prev => prev.map(h => h.id === editingId ? baseData as Holding : h));
      addToast('Holding updated', 'success');
    } else {
      setHoldings(prev => [...prev, baseData as Holding]);
      addToast('Holding added', 'success');
    }

    setShowModal(false);
  };

  const renderFormFields = () => {
    switch (holdingType) {
      case 'stock':
        return (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Symbol *</label>
                <input
                  type="text"
                  value={formData.symbol || ''}
                  onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="NVDA"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Company Name *</label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="NVIDIA"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Units *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.units || ''}
                  onChange={(e) => setFormData({ ...formData, units: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="10"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current Value (AUD) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.value || ''}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="2500"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Avg Buy Price (optional)</label>
              <input
                type="number"
                step="0.01"
                value={formData.avgBuyPrice || ''}
                onChange={(e) => setFormData({ ...formData, avgBuyPrice: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="120"
              />
            </div>
          </>
        );

      case 'crypto':
        return (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Symbol *</label>
                <input
                  type="text"
                  value={formData.symbol || ''}
                  onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="BTC"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Bitcoin"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Units *</label>
                <input
                  type="number"
                  step="0.000001"
                  value={formData.units || ''}
                  onChange={(e) => setFormData({ ...formData, units: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.5"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current Value (AUD) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.value || ''}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="50000"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">24h Change %</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.change || ''}
                  onChange={(e) => setFormData({ ...formData, change: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="5.2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Avg Buy Price (optional)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.avgBuyPrice || ''}
                  onChange={(e) => setFormData({ ...formData, avgBuyPrice: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="45000"
                />
              </div>
            </div>
          </>
        );

      case 'realEstate':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Property Name *</label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Southport QLD Property"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current Value (AUD) *</label>
                <input
                  type="number"
                  step="1000"
                  value={formData.value || ''}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="1000000"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Location</label>
                <input
                  type="text"
                  value={formData.location || ''}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Australia"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Purchase Date</label>
              <input
                type="date"
                value={formData.purchaseDate || ''}
                onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea
                value={formData.notes || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Additional notes..."
                rows={3}
              />
            </div>
          </>
        );

      case 'vehicle':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Vehicle Name *</label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Land Rover 2023 Defender"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current Value (AUD) *</label>
                <input
                  type="number"
                  step="100"
                  value={formData.value || ''}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="100000"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                <input
                  type="text"
                  value={formData.vehicleType || ''}
                  onChange={(e) => setFormData({ ...formData, vehicleType: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="4WD"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Year</label>
              <input
                type="number"
                value={formData.year || ''}
                onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="2023"
              />
            </div>
          </>
        );

      case 'cash':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Account Name *</label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Rabobank PremiumSaver"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Balance (AUD) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.value || ''}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="100000"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Institution</label>
                <input
                  type="text"
                  value={formData.institution || ''}
                  onChange={(e) => setFormData({ ...formData, institution: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Rabobank"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">APY %</label>
              <input
                type="number"
                step="0.01"
                value={formData.apy || ''}
                onChange={(e) => setFormData({ ...formData, apy: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="5.0"
              />
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {[
          { type: 'realEstate', label: 'Real Estate', value: totals.realEstate, icon: Building2, color: 'blue' },
          { type: 'cash', label: 'Cash', value: totals.cash, icon: Wallet, color: 'green' },
          { type: 'crypto', label: 'Crypto', value: totals.crypto, icon: Bitcoin, color: 'yellow' },
          { type: 'vehicle', label: 'Vehicles', value: totals.vehicle, icon: Car, color: 'purple' },
          { type: 'stock', label: 'Stocks', value: totals.stock, icon: LineChart, color: 'red' },
        ].map(({ type, label, value, icon: Icon, color }) => (
          <div key={type} className={`bg-${color}-50 rounded-xl p-4 border border-${color}-100`}>
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-5 h-5 text-${color}-600`} />
              <h3 className={`font-semibold text-${color}-900 text-sm`}>{label}</h3>
            </div>
            <p className={`text-xl font-bold text-${color}-900`}>${(value).toLocaleString()}</p>
            <p className={`text-xs text-${color}-600`}>{totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : 0}% of portfolio</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Portfolio Allocation</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${percent ? (percent * 100).toFixed(0) : 0}%`}
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => typeof value === 'number' ? `$${value.toLocaleString()}` : value} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Holdings by Category</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value) => typeof value === 'number' ? `$${value.toLocaleString()}` : value} />
                <Bar dataKey="value" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Risk Analysis */}
      <RiskAnalysis />

      {/* Add Holding Buttons */}
      <div className="flex flex-wrap gap-2">
        <span className="text-sm font-medium text-slate-600 self-center mr-2">Add Holding:</span>
        {[
          { type: 'stock', label: 'Stock', icon: LineChart },
          { type: 'crypto', label: 'Crypto', icon: Bitcoin },
          { type: 'realEstate', label: 'Property', icon: Home },
          { type: 'vehicle', label: 'Vehicle', icon: Car },
          { type: 'cash', label: 'Cash Account', icon: Wallet },
        ].map(({ type, label, icon: Icon }) => (
          <button
            key={type}
            onClick={() => handleAdd(type)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Holdings Sections */}
      <div className="space-y-6">
        {/* Stocks */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <LineChart className="w-5 h-5 text-red-600" />
              Stocks ({stockHoldings.length})
            </h3>
            <button onClick={() => handleAdd('stock')} className="text-sm text-blue-600 hover:text-blue-700">
              + Add Stock
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 text-sm font-medium text-slate-500">Symbol</th>
                  <th className="text-left py-2 text-sm font-medium text-slate-500">Name</th>
                  <th className="text-right py-2 text-sm font-medium text-slate-500">Units</th>
                  <th className="text-right py-2 text-sm font-medium text-slate-500">Value</th>
                  <th className="text-right py-2 text-sm font-medium text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stockHoldings.map((stock) => (
                  <tr key={stock.id} className="border-b border-slate-100">
                    <td className="py-3 font-medium text-slate-800">{stock.symbol}</td>
                    <td className="py-3 text-slate-600">{stock.name}</td>
                    <td className="py-3 text-right text-slate-600">{stock.units}</td>
                    <td className="py-3 text-right font-medium text-slate-800">${stock.value.toLocaleString()}</td>
                    <td className="py-3 text-right">
                      <button onClick={() => handleEdit(stock)} className="p-1 hover:bg-slate-100 rounded mr-1">
                        <Edit2 className="w-4 h-4 text-slate-400" />
                      </button>
                      <button onClick={() => handleDelete(stock.id)} className="p-1 hover:bg-red-50 rounded">
                        <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-500" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Crypto */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <Bitcoin className="w-5 h-5 text-yellow-600" />
              Cryptocurrency ({cryptoHoldings.length})
            </h3>
            <button onClick={() => handleAdd('crypto')} className="text-sm text-blue-600 hover:text-blue-700">
              + Add Crypto
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 text-sm font-medium text-slate-500">Asset</th>
                  <th className="text-right py-2 text-sm font-medium text-slate-500">Units</th>
                  <th className="text-right py-2 text-sm font-medium text-slate-500">Value</th>
                  <th className="text-right py-2 text-sm font-medium text-slate-500">24h</th>
                  <th className="text-right py-2 text-sm font-medium text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cryptoHoldings.map((coin) => (
                  <tr key={coin.id} className="border-b border-slate-100">
                    <td className="py-3">
                      <div>
                        <p className="font-medium text-slate-800">{coin.name}</p>
                        <p className="text-xs text-slate-500">{coin.symbol}</p>
                      </div>
                    </td>
                    <td className="py-3 text-right text-slate-600">{coin.units}</td>
                    <td className="py-3 text-right font-medium text-slate-800">${coin.value.toLocaleString()}</td>
                    <td className="py-3 text-right">
                      <span className={`flex items-center justify-end gap-1 text-sm ${coin.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {coin.change >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                        {Math.abs(coin.change)}%
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <button onClick={() => handleEdit(coin)} className="p-1 hover:bg-slate-100 rounded mr-1">
                        <Edit2 className="w-4 h-4 text-slate-400" />
                      </button>
                      <button onClick={() => handleDelete(coin.id)} className="p-1 hover:bg-red-50 rounded">
                        <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-500" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Real Estate */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              Real Estate ({realEstateHoldings.length})
            </h3>
            <button onClick={() => handleAdd('realEstate')} className="text-sm text-blue-600 hover:text-blue-700">
              + Add Property
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {realEstateHoldings.map((property) => (
              <div key={property.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div>
                  <p className="font-medium text-slate-800">{property.name}</p>
                  <p className="text-sm text-slate-500">{property.location}</p>
                  {property.purchaseDate && (
                    <p className="text-xs text-slate-400">Purchased: {property.purchaseDate}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <p className="font-bold text-slate-800">${property.value.toLocaleString()}</p>
                  <button onClick={() => handleEdit(property)} className="p-1 hover:bg-slate-200 rounded">
                    <Edit2 className="w-4 h-4 text-slate-400" />
                  </button>
                  <button onClick={() => handleDelete(property.id)} className="p-1 hover:bg-red-100 rounded">
                    <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-500" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Vehicles */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <Car className="w-5 h-5 text-purple-600" />
              Vehicles ({vehicleHoldings.length})
            </h3>
            <button onClick={() => handleAdd('vehicle')} className="text-sm text-blue-600 hover:text-blue-700">
              + Add Vehicle
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vehicleHoldings.map((vehicle) => (
              <div key={vehicle.id} className="p-4 bg-slate-50 rounded-lg">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-slate-800">{vehicle.name}</p>
                    <p className="text-sm text-slate-500">{vehicle.vehicleType} {vehicle.year && `• ${vehicle.year}`}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <p className="font-bold text-slate-800">${vehicle.value.toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1 mt-3">
                  <button onClick={() => handleEdit(vehicle)} className="p-1 hover:bg-slate-200 rounded">
                    <Edit2 className="w-4 h-4 text-slate-400" />
                  </button>
                  <button onClick={() => handleDelete(vehicle.id)} className="p-1 hover:bg-red-100 rounded">
                    <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-500" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cash */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <Wallet className="w-5 h-5 text-green-600" />
              Cash Accounts ({cashHoldings.length})
            </h3>
            <button onClick={() => handleAdd('cash')} className="text-sm text-blue-600 hover:text-blue-700">
              + Add Account
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {cashHoldings.map((account) => (
              <div key={account.id} className="p-4 bg-slate-50 rounded-lg">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-slate-800">{account.name}</p>
                    <p className="text-sm text-slate-500">{account.institution}</p>
                    {account.apy !== undefined && (
                      <p className="text-xs text-green-600">{account.apy}% APY</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-slate-800">${account.value.toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1 mt-3">
                  <button onClick={() => handleEdit(account)} className="p-1 hover:bg-slate-200 rounded">
                    <Edit2 className="w-4 h-4 text-slate-400" />
                  </button>
                  <button onClick={() => handleDelete(account.id)} className="p-1 hover:bg-red-100 rounded">
                    <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-500" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-800">
                {editingId ? 'Edit' : 'Add'} {holdingType === 'realEstate' ? 'Property' : holdingType === 'vehicle' ? 'Vehicle' : holdingType === 'cash' ? 'Cash Account' : holdingType}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {renderFormFields()}
              <div className="flex justify-end gap-3 pt-4">
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
                  {editingId ? 'Save Changes' : 'Add Holding'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Portfolio;
