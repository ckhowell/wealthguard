import { useState, useEffect, useMemo } from 'react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';
import { 
  TrendingUp, TrendingDown, Clock, RefreshCw, AlertCircle,
  Search, Filter, Star, StarOff, ArrowUpRight, ArrowDownRight,
  Activity, Wifi, WifiOff
} from 'lucide-react';
import { usePersistentState } from '../hooks/usePersistentState';

// API Configuration - Use relative paths for production
const API_BASE_URL = '';  // Empty = relative to current domain

interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  price_aud?: number;
  change: number;
  change_percent: number;
  currency: string;
  sector: string;
  market_cap?: number;
  volume?: number;
  source: 'live' | 'mock';
}

interface MarketData {
  region: string;
  count: number;
  updated_at: string;
  quotes: StockQuote[];
}

interface MarketIndex {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_percent: number;
}

type MarketRegion = 'US' | 'AU' | 'CN' | 'CRYPTO';

const MultiMarketPage = () => {
  const [activeMarket, setActiveMarket] = useState<MarketRegion>('AU');
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'change' | 'volume' | 'marketCap' | 'yield'>('change');
  
  const [watchlist, setWatchlist] = usePersistentState<string[]>('multimarket-watchlist', [
    'US:VST', 'US:AVGO', 'US:TMO', 'US:LLY', 'US:GLD', 
    'US:CI', 'US:OKTA', 'US:DVN', 'US:GD', 'US:BAH'
  ]);
  const [selectedStock, setSelectedStock] = useState<StockQuote | null>(null);
  const [intradayData, setIntradayData] = useState<any[]>([]);

  // Market indices configuration
  const marketIndices: Record<MarketRegion, MarketIndex[]> = {
    US: [
      { symbol: 'SPX', name: 'S&P 500', price: 5580.25, change: 41.85, change_percent: 0.75 },
      { symbol: 'DJI', name: 'Dow Jones', price: 42150.80, change: 189.67, change_percent: 0.45 },
      { symbol: 'IXIC', name: 'NASDAQ', price: 17890.60, change: 221.45, change_percent: 1.25 },
      { symbol: 'RUT', name: 'Russell 2000', price: 2025.40, change: -7.09, change_percent: -0.35 },
      { symbol: 'VIX', name: 'VIX', price: 14.20, change: -0.31, change_percent: -2.15 },
    ],
    AU: [
      { symbol: 'XJO', name: 'ASX 200', price: 7850.40, change: 42.85, change_percent: 0.55 },
      { symbol: 'XKO', name: 'ASX 300', price: 7855.20, change: 40.65, change_percent: 0.52 },
      { symbol: 'XAO', name: 'All Ordinaries', price: 8125.80, change: 38.90, change_percent: 0.48 },
    ],
    CN: [
      { symbol: 'SH000001', name: 'SSE Composite', price: 3052.34, change: 15.20, change_percent: 0.50 },
      { symbol: 'SZ399001', name: 'SZSE Component', price: 9488.56, change: 45.30, change_percent: 0.48 },
      { symbol: 'SZ399006', name: 'ChiNext Index', price: 1821.45, change: 12.80, change_percent: 0.71 },
      { symbol: 'SH000300', name: 'CSI 300', price: 3567.20, change: 18.90, change_percent: 0.53 },
    ],
    CRYPTO: [
      { symbol: 'TOTAL', name: 'Total Market Cap', price: 2.85, change: 0.08, change_percent: 2.89 },
      { symbol: 'BTC.D', name: 'Bitcoin Dominance', price: 52.4, change: 0.3, change_percent: 0.58 },
      { symbol: 'ETH.D', name: 'Ethereum Dominance', price: 16.8, change: -0.2, change_percent: -1.18 },
      { symbol: 'FNG', name: 'Fear & Greed', price: 72, change: 5, change_percent: 7.46 },
    ],
  };

  const fetchMarketData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/markets/${activeMarket}`);
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const data: MarketData = await response.json();
      setQuotes(data.quotes);
      setIndices(marketIndices[activeMarket] || []);
      setLastUpdated(new Date(data.updated_at));
      
      // Check if we have live data
      const hasLiveData = data.quotes.some(q => q.source === 'live');
      setIsLive(hasLiveData);
      
    } catch (err) {
      console.error('Failed to fetch market data:', err);
      setError('Failed to connect to WealthGuard API. Using fallback data.');
      setIsLive(false);
      
      // Use mock data as fallback
      setQuotes(getMockData(activeMarket));
      setIndices(marketIndices[activeMarket] || []);
      setLastUpdated(new Date());
    } finally {
      setIsLoading(false);
    }
  };

  // Trigger price sync
  const triggerSync = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/sync/prices`, { method: 'POST' });
      // Wait a moment then refresh
      setTimeout(fetchMarketData, 2000);
    } catch (err) {
      console.error('Failed to trigger sync:', err);
    }
  };

  // Mock data fallback
  const getMockData = (region: MarketRegion): StockQuote[] => {
    const mockStocks: Record<MarketRegion, Partial<StockQuote>[]> = {
      US: [
        { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', price: 225.50 },
        { symbol: 'MSFT', name: 'Microsoft', sector: 'Technology', price: 420.80 },
        { symbol: 'NVDA', name: 'NVIDIA', sector: 'Technology', price: 138.20 },
        { symbol: 'GOOGL', name: 'Alphabet', sector: 'Technology', price: 178.90 },
        { symbol: 'AMZN', name: 'Amazon', sector: 'Consumer', price: 198.40 },
        { symbol: 'META', name: 'Meta', sector: 'Technology', price: 595.20 },
        { symbol: 'TSLA', name: 'Tesla', sector: 'Consumer', price: 268.30 },
      ],
      AU: [
        { symbol: 'CBA.AX', name: 'Commonwealth Bank', sector: 'Financials', price: 158.20 },
        { symbol: 'BHP.AX', name: 'BHP Group', sector: 'Materials', price: 42.80 },
        { symbol: 'RIO.AX', name: 'Rio Tinto', sector: 'Materials', price: 118.50 },
        { symbol: 'NAB.AX', name: 'NAB', sector: 'Financials', price: 38.90 },
        { symbol: 'WBC.AX', name: 'Westpac', sector: 'Financials', price: 32.40 },
        { symbol: 'ANZ.AX', name: 'ANZ Bank', sector: 'Financials', price: 32.10 },
        { symbol: 'WES.AX', name: 'Wesfarmers', sector: 'Consumer', price: 68.50 },
      ],
      CN: [
        { symbol: '600519.SS', name: 'Kweichow Moutai', sector: 'Consumer Staples', price: 1680.50 },
        { symbol: '601318.SS', name: 'Ping An Insurance', sector: 'Financials', price: 42.80 },
        { symbol: '600036.SS', name: 'China Merchants Bank', sector: 'Financials', price: 35.20 },
        { symbol: '300750.SZ', name: 'CATL', sector: 'Technology', price: 185.60 },
        { symbol: '002594.SZ', name: 'BYD', sector: 'Consumer', price: 245.80 },
      ],
      CRYPTO: [
        { symbol: 'BTC', name: 'Bitcoin', sector: 'Crypto', price: 87500.00 },
        { symbol: 'ETH', name: 'Ethereum', sector: 'Crypto', price: 3250.00 },
        { symbol: 'SOL', name: 'Solana', sector: 'Crypto', price: 145.20 },
        { symbol: 'XRP', name: 'XRP', sector: 'Crypto', price: 0.65 },
        { symbol: 'SUI', name: 'Sui', sector: 'Crypto', price: 3.45 },
      ],
    };

    return mockStocks[region]?.map(stock => {
      const basePrice = stock.price || 100;
      const changePercent = (Math.random() - 0.5) * 8;
      const change = basePrice * (changePercent / 100);
      
      return {
        ...stock,
        price: basePrice + change,
        change,
        change_percent: changePercent,
        currency: region === 'US' || region === 'CRYPTO' ? 'USD' : (region === 'AU' ? 'AUD' : 'CNY'),
        source: 'mock',
      } as StockQuote;
    }) || [];
  };

  useEffect(() => {
    fetchMarketData();
    const interval = setInterval(fetchMarketData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [activeMarket]);

  useEffect(() => {
    if (selectedStock) {
      // Generate intraday data
      const data = [];
      let price = selectedStock.price * 0.98;
      
      for (let i = 0; i < 240; i++) {
        const change = (Math.random() - 0.48) * 0.5;
        price *= (1 + change / 100);
        
        data.push({
          time: `${9 + Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}`,
          price: Number(price.toFixed(2)),
        });
      }
      
      setIntradayData(data);
    }
  }, [selectedStock]);

  const filteredStocks = useMemo(() => {
    let result = quotes;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(s => 
        s.name.toLowerCase().includes(query) ||
        s.symbol.toLowerCase().includes(query) ||
        s.sector.toLowerCase().includes(query)
      );
    }
    
    if (sectorFilter !== 'All') {
      result = result.filter(s => s.sector === sectorFilter);
    }
    
    return result.sort((a, b) => {
      if (sortBy === 'change') return b.change_percent - a.change_percent;
      if (sortBy === 'volume') return (b.volume || 0) - (a.volume || 0);
      if (sortBy === 'marketCap') return (b.market_cap || 0) - (a.market_cap || 0);
      return 0;
    });
  }, [quotes, searchQuery, sectorFilter, sortBy]);

  const sectors = useMemo(() => {
    return ['All', ...new Set(quotes.map(s => s.sector))];
  }, [quotes]);

  const toggleWatchlist = (symbol: string) => {
    setWatchlist(prev => 
      prev.includes(symbol) 
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol]
    );
  };

  const marketConfig = {
    US: { color: 'blue', currency: '$', flag: '🇺🇸', name: 'US Markets', hours: '9:30 AM - 4:00 PM ET' },
    AU: { color: 'green', currency: 'A$', flag: '🇦🇺', name: 'ASX', hours: '10:00 AM - 4:00 PM AEST' },
    CN: { color: 'red', currency: '¥', flag: '🇨🇳', name: 'China A-Share', hours: '9:30 AM - 3:00 PM CST' },
    CRYPTO: { color: 'purple', currency: '$', flag: '₿', name: 'Crypto Markets', hours: '24/7' },
  };

  const config = marketConfig[activeMarket];

  return (
    <div className="space-y-6">
      {/* Error Banner */}
      {error && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <WifiOff className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-amber-800">{error}</p>
            <button 
              onClick={fetchMarketData}
              className="text-sm text-amber-700 underline mt-1 hover:no-underline"
            >
              Retry connection
            </button>
          </div>
        </div>
      )}

      {/* Live Status Banner */}
      {isLive && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
          <Wifi className="w-4 h-4 text-green-600" />
          <span className="text-sm text-green-800 font-medium">Live data connected</span>
          <span className="text-xs text-green-600 ml-auto">
            Updates every 5 minutes via WealthGuard API
          </span>
        </div>
      )}

      {/* Market Selector */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-wrap gap-3">
          {(Object.keys(marketConfig) as MarketRegion[]).map((market) => (
            <button
              key={market}
              onClick={() => setActiveMarket(market)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                activeMarket === market
                  ? market === 'US' ? 'bg-blue-100 text-blue-700'
                    : market === 'AU' ? 'bg-green-100 text-green-700'
                    : market === 'CN' ? 'bg-red-100 text-red-700'
                    : 'bg-purple-100 text-purple-700'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span className="text-lg">{marketConfig[market].flag}</span>
              <span>{marketConfig[market].name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Header */}
      <div className={`bg-gradient-to-r rounded-xl p-6 text-white ${
        activeMarket === 'US' ? 'from-blue-600 to-blue-700'
        : activeMarket === 'AU' ? 'from-green-600 to-green-700'
        : activeMarket === 'CN' ? 'from-red-600 to-red-700'
        : 'from-purple-600 to-purple-700'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-3xl">{config.flag}</span>
              <h1 className="text-2xl font-bold">{config.name}</h1>
              {isLive && (
                <span className="px-2 py-0.5 bg-white/20 rounded text-xs font-medium">
                  LIVE
                </span>
              )}
            </div>
            <p className="opacity-80">{config.hours} | {quotes.length} stocks tracked</p>
          </div>
          
          <div className="text-right">
            <div className="flex items-center gap-2 opacity-80 mb-1">
              <Clock className="w-4 h-4" />
              <span>{lastUpdated?.toLocaleTimeString() || 'Loading...'}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={triggerSync}
                disabled={isLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors text-sm"
                title="Trigger price sync"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                Sync
              </button>
              <button
                onClick={fetchMarketData}
                disabled={isLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors text-sm"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="bg-white/10 rounded-lg px-4 py-2">
            <p className="text-sm opacity-70">Currency</p>
            <p className="text-xl font-bold">{config.currency}</p>
          </div>
          <div className="bg-white/10 rounded-lg px-4 py-2">
            <p className="text-sm opacity-70">Stocks</p>
            <p className="text-xl font-bold">{quotes.length}</p>
          </div>
          <div className="bg-white/10 rounded-lg px-4 py-2">
            <p className="text-sm opacity-70">Advancing</p>
            <p className="text-xl font-bold text-green-300">{quotes.filter(s => s.change > 0).length}</p>
          </div>
          <div className="bg-white/10 rounded-lg px-4 py-2">
            <p className="text-sm opacity-70">Declining</p>
            <p className="text-xl font-bold text-red-300">{quotes.filter(s => s.change < 0).length}</p>
          </div>
        </div>
      </div>

      {/* Indices */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {indices.map((index) => (
          <div key={index.symbol} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <p className="text-sm font-medium text-slate-800">{index.name}</p>
            <p className="text-lg font-bold text-slate-800 mt-1">
              {activeMarket === 'CRYPTO' && index.symbol === 'TOTAL' 
                ? `$${index.price.toFixed(2)}T`
                : `${config.currency}${index.price.toFixed(2)}`
              }
            </p>
            <div className={`flex items-center gap-1 text-sm ${index.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {index.change >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              <span>{index.change >= 0 ? '+' : ''}{index.change_percent.toFixed(2)}%</span>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search stocks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {sectors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="change">Sort by Change %</option>
            <option value="volume">Sort by Volume</option>
            <option value="marketCap">Sort by Market Cap</option>
          </select>
        </div>
      </div>

      {/* Stock Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">
            {activeMarket === 'CN' ? 'China A-Share' : activeMarket === 'AU' ? 'ASX' : activeMarket === 'CRYPTO' ? 'Crypto' : 'US Markets'}
            <span className="text-sm font-normal text-slate-500 ml-2">({filteredStocks.length})</span>
          </h2>
          {isLive && (
            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
              Live prices
            </span>
          )}
        </div>
        
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Stock</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Sector</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">Price</th>
                {(activeMarket === 'US' || activeMarket === 'CRYPTO') && (
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">AUD</th>
                )}
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">Change</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-slate-500">Source</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-slate-500">Watch</th>
              </tr>
            </thead>
            <tbody>
              {filteredStocks.map((stock) => (
                <tr 
                  key={stock.symbol} 
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => setSelectedStock(stock)}
                >
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-slate-800">{stock.name}</p>
                      <p className="text-xs text-slate-500">{stock.symbol}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-1 bg-slate-100 rounded-full text-slate-600">
                      {stock.sector}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-800">
                    {stock.currency === 'USD' ? '$' : stock.currency === 'AUD' ? 'A$' : '¥'}
                    {stock.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  {(activeMarket === 'US' || activeMarket === 'CRYPTO') && (
                    <td className="px-4 py-3 text-right text-slate-600 text-sm">
                      {stock.price_aud && (
                        <>A${stock.price_aud.toLocaleString(undefined, { minimumFractionDigits: 2 })}</>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <div className={`flex items-center justify-end gap-1 ${stock.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {stock.change >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      <span className="font-medium">{stock.change >= 0 ? '+' : ''}{stock.change_percent.toFixed(2)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      stock.source === 'live' 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {stock.source === 'live' ? 'Live' : 'Mock'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWatchlist(`${activeMarket}:${stock.symbol}`);
                      }}
                      className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors"
                    >
                      {watchlist.includes(`${activeMarket}:${stock.symbol}`) ? (
                        <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                      ) : (
                        <StarOff className="w-4 h-4 text-slate-400" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Detail Modal */}
      {selectedStock && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-bold text-slate-800">{selectedStock.name}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    selectedStock.source === 'live' 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                    {selectedStock.source === 'live' ? 'Live Data' : 'Mock Data'}
                  </span>
                </div>
                <p className="text-slate-500">{selectedStock.symbol} • {selectedStock.sector}</p>
              </div>
              <button
                onClick={() => setSelectedStock(null)}
                className="p-2 hover:bg-slate-100 rounded-lg text-2xl"
              >
                ×
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-sm text-slate-500">Current Price</p>
                  <p className="text-2xl font-bold text-slate-800">
                    {selectedStock.currency === 'USD' ? '$' : selectedStock.currency === 'AUD' ? 'A$' : '¥'}
                    {selectedStock.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
                {(activeMarket === 'US' || activeMarket === 'CRYPTO') && selectedStock.price_aud && (
                  <div className="bg-slate-50 rounded-lg p-4">
                    <p className="text-sm text-slate-500">Price (AUD)</p>
                    <p className="text-2xl font-bold text-slate-800">
                      A${selectedStock.price_aud.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                )}
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-sm text-slate-500">Change</p>
                  <p className={`text-2xl font-bold ${selectedStock.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {selectedStock.change >= 0 ? '+' : ''}{selectedStock.change_percent.toFixed(2)}%
                  </p>
                </div>
                {selectedStock.market_cap && (
                  <div className="bg-slate-50 rounded-lg p-4">
                    <p className="text-sm text-slate-500">Market Cap</p>
                    <p className="text-xl font-bold text-slate-800">
                      ${(selectedStock.market_cap / 1e9).toFixed(1)}B
                    </p>
                  </div>
                )}
                {selectedStock.volume && (
                  <div className="bg-slate-50 rounded-lg p-4">
                    <p className="text-sm text-slate-500">Volume (24h)</p>
                    <p className="text-xl font-bold text-slate-800">
                      ${(selectedStock.volume / 1e9).toFixed(1)}B
                    </p>
                  </div>
                )}
              </div>
              
              <div>
                <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Intraday Chart
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={intradayData}>
                      <defs>
                        <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={activeMarket === 'US' ? '#3b82f6' : activeMarket === 'AU' ? '#22c55e' : activeMarket === 'CN' ? '#ef4444' : '#a855f7'} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={activeMarket === 'US' ? '#3b82f6' : activeMarket === 'AU' ? '#22c55e' : activeMarket === 'CN' ? '#ef4444' : '#a855f7'} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke="#64748b" />
                      <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12 }} stroke="#64748b" />
                      <Tooltip contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                      <Area 
                        type="monotone" 
                        dataKey="price" 
                        stroke={activeMarket === 'US' ? '#3b82f6' : activeMarket === 'AU' ? '#22c55e' : activeMarket === 'CN' ? '#ef4444' : '#a855f7'}
                        fillOpacity={1} 
                        fill="url(#colorPrice)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              
              <button
                onClick={() => toggleWatchlist(`${activeMarket}:${selectedStock.symbol}`)}
                className={`w-full py-3 rounded-lg font-medium flex items-center justify-center gap-2 ${
                  watchlist.includes(`${activeMarket}:${selectedStock.symbol}`)
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {watchlist.includes(`${activeMarket}:${selectedStock.symbol}`) ? (
                  <><Star className="w-5 h-5 fill-amber-500" /> Remove from Watchlist</>
                ) : (
                  <><StarOff className="w-5 h-5" /> Add to Watchlist</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-slate-600">
            <p className="font-medium mb-1">Data Source</p>
            <p>
              {isLive 
                ? "Live prices from CoinGecko, Yahoo Finance, and other market data providers. Updated every 5 minutes."
                : "Currently displaying fallback data. Connect to WealthGuard API for live prices."
              }
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MultiMarketPage;
