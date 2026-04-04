import { useEffect, useState, useCallback } from 'react';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  XAxis, YAxis, CartesianGrid,
  AreaChart, Area
} from 'recharts';
import { 
  Wallet, Building2, Car, Bitcoin, LineChart as LineChartIcon,
  TrendingUp, TrendingDown, AlertTriangle,
  RefreshCw, ArrowRight, Loader2, DollarSign
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePersistentState } from '../hooks/usePersistentState';
import { usdToAud, formatCurrency } from '../services/priceService';
import { fetchCryptoPrices } from '../services/priceService';
import type { PriceData } from '../services/priceService';
import CurrencyConverter from '../components/CurrencyConverter';
import NetWorthTracker from '../components/NetWorthTracker';

interface Holding {
  id: number;
  name: string;
  value: number;
  type: string;
  symbol?: string;
  units?: number;
  avgBuyPrice?: number;
  institution?: string;
  apy?: number;
  location?: string;
}

const netWorthHistory = [
  { month: 'Oct', value: 3650000 },
  { month: 'Nov', value: 3685000 },
  { month: 'Dec', value: 3720000 },
  { month: 'Jan', value: 3755000 },
  { month: 'Feb', value: 3780000 },
  { month: 'Mar', value: 3828255 },
];

const budgetData = [
  { category: 'Groceries', budget: 1000, spent: 736, remaining: 264 },
  { category: 'Food & Dining', budget: 800, spent: 0, remaining: 800 },
  { category: 'Transportation', budget: 500, spent: 198, remaining: 302 },
  { category: 'Software', budget: 400, spent: 512, remaining: -112 },
];

const defaultHoldings: Holding[] = [
  // Real Estate - Updated values
  { id: 1, name: 'Southport QLD Property', value: 1100000, location: 'Australia', type: 'realEstate' },
  { id: 2, name: 'Niseko Japan Property', value: 400000, location: 'Japan', type: 'realEstate' },
  { id: 3, name: 'Ansons Bay TAS (143-145)', value: 470000, location: 'Australia', type: 'realEstate' },
  { id: 4, name: 'Ansons Bay TAS (18)', value: 420000, location: 'Australia', type: 'realEstate' },
  // Cash - Updated from database (AUD values)
  { id: 5, name: 'Rabobank PremiumSaver', value: 261822, institution: 'Rabobank', type: 'cash', apy: 5.50 },
  { id: 6, name: 'Rabobank High Interest', value: 170650, institution: 'Rabobank', type: 'cash', apy: 5.50 },
  { id: 7, name: 'Wise JPY Account', value: 147886, institution: 'Wise', type: 'cash', apy: 0 },
  // Crypto - Updated values from database
  { id: 8, symbol: 'BTC', name: 'Bitcoin', units: 2.81, value: 188126, type: 'crypto', avgBuyPrice: 45000 },
  { id: 9, symbol: 'ETH', name: 'Ethereum', units: 64, value: 131640, type: 'crypto', avgBuyPrice: 1800 },
  { id: 10, symbol: 'SOL', name: 'Solana', units: 270, value: 21330, type: 'crypto', avgBuyPrice: 85 },
  { id: 11, symbol: 'XRP', name: 'Ripple', units: 2303, value: 3035, type: 'crypto', avgBuyPrice: 1.2 },
  { id: 12, symbol: 'SUI', name: 'Sui', units: 901, value: 775, type: 'crypto', avgBuyPrice: 3.5 },
  // Vehicles
  { id: 13, name: 'Land Rover 2023 Defender', value: 100000, type: 'vehicle' },
  { id: 14, name: 'VW 2024 GTi Golf', value: 55000, type: 'vehicle' },
  { id: 15, name: 'Land Rover 2011 Defender', value: 20000, type: 'vehicle' },
  { id: 16, name: 'Triumph T120 2023', value: 17000, type: 'vehicle' },
  { id: 17, name: 'Trailer', value: 2500, type: 'vehicle' },
  // Stocks - Updated to match actual holdings (in AUD after conversion)
  { id: 18, symbol: 'NVDA', name: 'NVIDIA', units: 22.11, value: 6022, type: 'stock', avgBuyPrice: 176.77 },
  { id: 19, symbol: 'XLE', name: 'Energy ETF', units: 35.97, value: 3288, type: 'stock', avgBuyPrice: 62.55 },
  { id: 20, symbol: 'AAPL', name: 'Apple', units: 1.18, value: 466, type: 'stock', avgBuyPrice: 300.00 },
  { id: 21, symbol: 'GOOGL', name: 'Alphabet', units: 6.89, value: 3177, type: 'stock', avgBuyPrice: 290.65 },
  { id: 22, symbol: 'GPRO', name: 'GoPro', units: 7, value: 8, type: 'stock', avgBuyPrice: 0.97 },
];

const MetricCard = ({ title, value, change, changeType, icon: Icon, onRefresh, isLoading }: any) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const handleRefresh = () => {
    if (!onRefresh || isLoading) return;
    setIsRefreshing(true);
    onRefresh();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <h3 className="text-2xl font-bold text-slate-800 mt-1">{value}</h3>
          {change && (
            <div className={`flex items-center gap-1 mt-2 text-sm ${
              changeType === 'positive' ? 'text-green-600' : 'text-red-600'
            }`}>
              {changeType === 'positive' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              <span>{change}</span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="p-3 bg-slate-100 rounded-lg">
            <Icon className="w-6 h-6 text-slate-600" />
          </div>
          {onRefresh && (
            <button 
              onClick={handleRefresh}
              disabled={isLoading}
              className={`p-1.5 hover:bg-slate-100 rounded-lg transition-all disabled:opacity-50 ${isRefreshing || isLoading ? 'animate-spin' : ''}`}
              title="Refresh prices"
            >
              {isLoading ? <Loader2 className="w-4 h-4 text-slate-400" /> : <RefreshCw className="w-4 h-4 text-slate-400" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [holdings, setHoldings] = usePersistentState<Holding[]>('wealthguard-holdings', defaultHoldings);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [usdAudRate] = useState(1.447); // Updated FX rate

  // Extract symbols from holdings
  const cryptoSymbols = holdings
    .filter(h => h.type === 'crypto' && h.symbol)
    .map(h => h.symbol!);
  
  const stockSymbols = holdings
    .filter(h => h.type === 'stock' && h.symbol)
    .map(h => h.symbol!);

  // Fetch live prices from backend API
  const fetchLivePrices = useCallback(async () => {
    setIsLoadingPrices(true);
    setPriceError(null);
    
    try {
      // Fetch from backend API which has live prices via yfinance
      const response = await fetch('/api/holdings');
      if (!response.ok) throw new Error('API error');
      
      const apiHoldings = await response.json();
      const priceMap: Record<string, any> = {};
      
      // Build price map from API data
      apiHoldings.forEach((h: any) => {
        if (h.symbol && h.current_price) {
          priceMap[h.symbol.toUpperCase()] = {
            symbol: h.symbol.toUpperCase(),
            price: h.current_price,
            currency: h.asset_class === 'crypto' ? 'USD' : 'USD',
            lastUpdated: h.last_price_update || new Date().toISOString(),
          };
        }
      });
      
      // Also fetch crypto prices from CoinGecko for 24h change
      const cryptoPrices = await fetchCryptoPrices(cryptoSymbols);
      
      // Merge API prices with crypto 24h change data
      const freshPrices: Record<string, PriceData> = {};
      
      [...cryptoSymbols, ...stockSymbols].forEach(symbol => {
        const upperSymbol = symbol.toUpperCase();
        const apiPrice = priceMap[upperSymbol];
        const cryptoData = cryptoPrices[upperSymbol];
        
        if (apiPrice) {
          freshPrices[upperSymbol] = {
            symbol: upperSymbol,
            price: apiPrice.price,
            currency: apiPrice.currency,
            change24h: cryptoData?.change24h,
            lastUpdated: apiPrice.lastUpdated,
          };
        }
      });
      
      setPrices(freshPrices);
      setLastUpdated(new Date());
      
      // Update holdings with new prices
      const updatedHoldings = holdings.map(h => {
        if ((h.type === 'stock' || h.type === 'crypto') && h.symbol && freshPrices[h.symbol.toUpperCase()]) {
          const priceData = freshPrices[h.symbol.toUpperCase()];
          const priceUsd = priceData.price;
          
          // Convert to AUD for crypto (stocks are already displayed as-is for now)
          const priceAud = h.type === 'crypto' 
            ? usdToAud(priceUsd, usdAudRate)
            : priceUsd;
          
          const newValue = priceAud * (h.units || 0);
          
          return { 
            ...h, 
            value: newValue,
          };
        }
        return h;
      });
      
      setHoldings(updatedHoldings);
      
    } catch (error) {
      console.error('Failed to fetch prices:', error);
      setPriceError('Failed to fetch live prices. Using last known values.');
    } finally {
      setIsLoadingPrices(false);
    }
  }, [cryptoSymbols, stockSymbols, holdings, usdAudRate, setHoldings]);

  // Initial fetch on mount
  useEffect(() => {
    fetchLivePrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Calculate totals
  const totals = {
    realEstate: holdings.filter(h => h.type === 'realEstate').reduce((sum, h) => sum + h.value, 0),
    cash: holdings.filter(h => h.type === 'cash').reduce((sum, h) => sum + h.value, 0),
    crypto: holdings.filter(h => h.type === 'crypto').reduce((sum, h) => sum + h.value, 0),
    vehicle: holdings.filter(h => h.type === 'vehicle').reduce((sum, h) => sum + h.value, 0),
    stock: holdings.filter(h => h.type === 'stock').reduce((sum, h) => sum + h.value, 0),
  };

  const totalValue = Object.values(totals).reduce((sum, val) => sum + val, 0);

  // Get best APY
  const cashAccounts = holdings.filter(h => h.type === 'cash');
  const bestApy = cashAccounts.length > 0 
    ? Math.max(...cashAccounts.map(a => a.apy || 0))
    : 0;

  const assetData = [
    { name: 'Real Estate', value: totals.realEstate, color: '#3b82f6', icon: Building2 },
    { name: 'Cash', value: totals.cash, color: '#10b981', icon: Wallet },
    { name: 'Crypto', value: totals.crypto, color: '#f59e0b', icon: Bitcoin },
    { name: 'Vehicles', value: totals.vehicle, color: '#8b5cf6', icon: Car },
    { name: 'Stocks', value: totals.stock, color: '#ef4444', icon: LineChartIcon },
  ];

  return (
    <div className="space-y-6">
      {/* Live Price Warning */}
      {priceError && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center gap-2 text-yellow-800">
          <AlertTriangle className="w-5 h-5" />
          <span>{priceError}</span>
        </div>
      )}
      
      {/* Last Updated */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Last updated: {lastUpdated.toLocaleTimeString()}
          {isLoadingPrices && <span className="ml-2 text-blue-600">Updating prices...</span>}
        </p>
        <button 
          onClick={fetchLivePrices}
          disabled={isLoadingPrices}
          className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
        >
          {isLoadingPrices ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh Live Prices
        </button>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Total Net Worth"
          value={`$${(totalValue / 1000000).toFixed(2)}M`}
          change="Live prices enabled"
          changeType="positive"
          icon={Wallet}
          onRefresh={fetchLivePrices}
          isLoading={isLoadingPrices}
        />
        <MetricCard
          title="Real Estate"
          value={`$${(totals.realEstate / 1000000).toFixed(2)}M`}
          change={`${((totals.realEstate / totalValue) * 100).toFixed(1)}% of portfolio`}
          changeType="positive"
          icon={Building2}
        />
        <MetricCard
          title="Cash Savings"
          value={`$${Math.round(totals.cash).toLocaleString()}`}
          change={`${bestApy.toFixed(2)}% best APY`}
          changeType="positive"
          icon={Wallet}
        />
        <MetricCard
          title="Crypto Holdings"
          value={`$${(totals.crypto).toLocaleString()}`}
          change={`${((totals.crypto / totalValue) * 100).toFixed(1)}% of portfolio`}
          changeType="positive"
          icon={Bitcoin}
        />
      </div>

      {/* Live Prices Panel */}
      {Object.keys(prices).length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              Live Market Prices
              <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-1 rounded-full flex items-center gap-1">
                <DollarSign className="w-3 h-3" />
                {Object.values(prices)[0]?.currency || 'USD'}
              </span>
            </h3>
            <button 
              onClick={fetchLivePrices}
              disabled={isLoadingPrices}
              className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50 flex items-center gap-1"
            >
              {isLoadingPrices ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(prices).map(([symbol, priceData]) => (
              <div key={symbol} className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm font-medium text-slate-500">{symbol}</p>
                <p className="text-xl font-bold text-slate-800">
                  {formatCurrency(priceData.price, priceData.currency)}
                </p>
                {priceData.change24h !== undefined && (
                  <p className={`text-xs ${priceData.change24h >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {priceData.change24h >= 0 ? '+' : ''}{priceData.change24h.toFixed(2)}% (24h)
                  </p>
                )}
              </div>
            ))}
          </div>        </div>
      )}

      {/* Currency Converter & Quick Tools */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <CurrencyConverter defaultAmount={5500000} defaultFrom="JPY" defaultTo="AUD" />
        </div>
        
        <div className="lg:col-span-2 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl p-6 text-white">
          <h3 className="text-lg font-semibold mb-4">Portfolio Insights</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-sm text-blue-100">Real Estate</p>
              <p className="text-2xl font-bold">{((totals.realEstate / totalValue) * 100).toFixed(1)}%</p>
              <p className="text-xs text-blue-200">Risk: High concentration</p>
            </div>
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-sm text-blue-100">Liquid Assets</p>
              <p className="text-2xl font-bold">{(((totals.cash + totals.stock + totals.crypto) / totalValue) * 100).toFixed(1)}%</p>
              <p className="text-xs text-blue-200">Cash + Stocks + Crypto</p>
            </div>
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-sm text-blue-100">Passive Income</p>
              <p className="text-2xl font-bold">~$30K</p>
              <p className="text-xs text-blue-200">Est. annual yield</p>
            </div>
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-sm text-blue-100">FX Exposure</p>
              <p className="text-2xl font-bold">JPY</p>
              <p className="text-xs text-blue-200">$501K at risk</p>
            </div>
          </div>
          
          <div className="mt-4 p-4 bg-white/10 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-300 flex-shrink-0" />
              <div>
                <p className="font-medium">Advisory Note</p>
                <p className="text-sm text-blue-100 mt-1">
                  Your portfolio is heavily concentrated in real estate (65%). Consider diversifying 
                  $200-300K from cash into ASX dividend stocks for better income and liquidity.
                </p>
                <Link to="/advisor" className="inline-flex items-center gap-1 mt-2 text-sm font-medium text-white hover:text-blue-100">
                  View recommendations <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Asset Allocation</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={assetData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {assetData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => typeof value === 'number' ? `$${value.toLocaleString()}` : value} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            {assetData.map((asset) => (
              <div key={asset.name} className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: asset.color }}
                />
                <span className="text-sm text-slate-600">
                  {asset.name}: {((asset.value / totalValue) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Net Worth Trend</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={netWorthHistory}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" stroke="#64748b" />
                <YAxis 
                  stroke="#64748b" 
                  tickFormatter={(value) => `$${(value / 1000000).toFixed(1)}M`}
                />
                <Tooltip formatter={(value) => typeof value === 'number' ? `$${value.toLocaleString()}` : value} />
                <Area 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#3b82f6" 
                  fillOpacity={1} 
                  fill="url(#colorValue)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">6-Month Growth</p>
              <p className="text-xl font-bold text-green-600">+4.9%</p>
            </div>
            <Link 
              to="/portfolio"
              className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              View Details
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* Budget Status */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-800">Budget Status</h3>
          <Link 
            to="/budgets"
            className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            Manage Budgets
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {budgetData.map((budget) => {
            const percentage = (budget.spent / budget.budget) * 100;
            const isOver = percentage > 100;
            
            return (
              <div key={budget.category} className="space-y-2 p-4 bg-slate-50 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-slate-700">{budget.category}</span>
                  <span className={`font-medium ${isOver ? 'text-red-600' : 'text-slate-600'}`}>
                    {percentage.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isOver ? 'bg-red-500' : percentage > 80 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(percentage, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>${budget.spent}</span>
                  <span>${budget.budget}</span>
                </div>
                {isOver && (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Over budget
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Top Holdings</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 text-sm font-medium text-slate-500">Asset</th>
                  <th className="text-right py-3 text-sm font-medium text-slate-500">Type</th>
                  <th className="text-right py-3 text-sm font-medium text-slate-500">Value</th>
                  <th className="text-right py-3 text-sm font-medium text-slate-500">Allocation</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { name: 'Southport QLD Property', type: 'Real Estate', value: totals.realEstate > 0 ? 1100000 : 0, pct: totals.realEstate > 0 ? ((1100000 / totalValue) * 100).toFixed(1) : 0 },
                  { name: 'Cash Accounts', type: 'Cash', value: totals.cash, pct: ((totals.cash / totalValue) * 100).toFixed(1) },
                  { name: 'Bitcoin (BTC)', type: 'Crypto', value: holdings.find(h => h.symbol === 'BTC')?.value || 302509, pct: (((holdings.find(h => h.symbol === 'BTC')?.value || 302509) / totalValue) * 100).toFixed(1) },
                  { name: 'Ethereum (ETH)', type: 'Crypto', value: holdings.find(h => h.symbol === 'ETH')?.value || 208631, pct: (((holdings.find(h => h.symbol === 'ETH')?.value || 208631) / totalValue) * 100).toFixed(1) },
                  { name: 'Vehicles', type: 'Vehicles', value: totals.vehicle, pct: ((totals.vehicle / totalValue) * 100).toFixed(1) },
                ].filter(h => h.value > 0).slice(0, 5).map((holding) => (
                  <tr key={holding.name} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="py-3 text-sm font-medium text-slate-800">{holding.name}</td>
                    <td className="py-3 text-sm text-right text-slate-600">{holding.type}</td>
                    <td className="py-3 text-sm text-right font-medium text-slate-800">
                      ${holding.value.toLocaleString()}
                    </td>
                    <td className="py-3 text-sm text-right text-slate-600">{holding.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <NetWorthTracker currentNetWorth={totalValue} />
      </div>
    </div>
  );
};

export default Dashboard;
