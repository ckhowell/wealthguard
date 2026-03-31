import { useState, useEffect, useMemo } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { 
  Globe, TrendingUp, TrendingDown, Clock, RefreshCw, AlertCircle,
  Search, Filter, Star, StarOff, ArrowUpRight, ArrowDownRight,
  Activity, BarChart3
} from 'lucide-react';
import { usePersistentState } from '../hooks/usePersistentState';

// Extended A-Share stock universe - Top 50 by market cap
export const AShareUniverse = [
  // Financials
  { symbol: '600519', name: '贵州茅台', sector: 'Consumer Staples', marketCap: 2100 },
  { symbol: '601318', name: '中国平安', sector: 'Financials', marketCap: 850 },
  { symbol: '600036', name: '招商银行', sector: 'Financials', marketCap: 720 },
  { symbol: '601166', name: '兴业银行', sector: 'Financials', marketCap: 320 },
  { symbol: '600016', name: '民生银行', sector: 'Financials', marketCap: 140 },
  { symbol: '601398', name: '工商银行', sector: 'Financials', marketCap: 1800 },
  { symbol: '601288', name: '农业银行', sector: 'Financials', marketCap: 1200 },
  { symbol: '601988', name: '中国银行', sector: 'Financials', marketCap: 980 },
  { symbol: '601628', name: '中国人寿', sector: 'Financials', marketCap: 780 },
  { symbol: '600030', name: '中信证券', sector: 'Financials', marketCap: 280 },
  
  // Consumer
  { symbol: '000858', name: '五粮液', sector: 'Consumer Staples', marketCap: 520 },
  { symbol: '002594', name: '比亚迪', sector: 'Consumer Discretionary', marketCap: 680 },
  { symbol: '601888', name: '中国中免', sector: 'Consumer Discretionary', marketCap: 180 },
  { symbol: '600887', name: '伊利股份', sector: 'Consumer Staples', marketCap: 165 },
  { symbol: '603288', name: '海天味业', sector: 'Consumer Staples', marketCap: 210 },
  { symbol: '000333', name: '美的集团', sector: 'Consumer Discretionary', marketCap: 420 },
  { symbol: '000651', name: '格力电器', sector: 'Consumer Discretionary', marketCap: 195 },
  { symbol: '002475', name: '立讯精密', sector: 'Technology', marketCap: 280 },
  
  // Technology
  { symbol: '300750', name: '宁德时代', sector: 'Technology', marketCap: 890 },
  { symbol: '002371', name: '北方华创', sector: 'Technology', marketCap: 195 },
  { symbol: '603501', name: '韦尔股份', sector: 'Technology', marketCap: 115 },
  { symbol: '300760', name: '迈瑞医疗', sector: 'Healthcare', marketCap: 340 },
  { symbol: '300059', name: '东方财富', sector: 'Financials', marketCap: 220 },
  { symbol: '002230', name: '科大讯飞', sector: 'Technology', marketCap: 110 },
  { symbol: '688981', name: '中芯国际', sector: 'Technology', marketCap: 420 },
  { symbol: '688111', name: '金山办公', sector: 'Technology', marketCap: 125 },
  
  // Healthcare
  { symbol: '600276', name: '恒瑞医药', sector: 'Healthcare', marketCap: 280 },
  { symbol: '603259', name: '药明康德', sector: 'Healthcare', marketCap: 145 },
  { symbol: '000538', name: '云南白药', sector: 'Healthcare', marketCap: 98 },
  { symbol: '600436', name: '片仔癀', sector: 'Healthcare', marketCap: 135 },
  
  // Energy & Materials
  { symbol: '601088', name: '中国神华', sector: 'Energy', marketCap: 750 },
  { symbol: '600028', name: '中国石化', sector: 'Energy', marketCap: 720 },
  { symbol: '601857', name: '中国石油', sector: 'Energy', marketCap: 1450 },
  { symbol: '601899', name: '紫金矿业', sector: 'Materials', marketCap: 420 },
  { symbol: '600309', name: '万华化学', sector: 'Materials', marketCap: 240 },
  { symbol: '601600', name: '中国铝业', sector: 'Materials', marketCap: 95 },
  
  // Industrials
  { symbol: '601012', name: '隆基绿能', sector: 'Industrials', marketCap: 110 },
  { symbol: '601727', name: '上海电气', sector: 'Industrials', marketCap: 85 },
  { symbol: '601669', name: '中国电建', sector: 'Industrials', marketCap: 90 },
  { symbol: '601668', name: '中国建筑', sector: 'Industrials', marketCap: 210 },
  { symbol: '601390', name: '中国中铁', sector: 'Industrials', marketCap: 145 },
  { symbol: '601186', name: '中国铁建', sector: 'Industrials', marketCap: 115 },
  
  // Telecom & Utilities
  { symbol: '600941', name: '中国移动', sector: 'Telecom', marketCap: 2200 },
  { symbol: '600050', name: '中国联通', sector: 'Telecom', marketCap: 145 },
  { symbol: '601728', name: '中国电信', sector: 'Telecom', marketCap: 520 },
  { symbol: '600900', name: '长江电力', sector: 'Utilities', marketCap: 680 },
  { symbol: '601985', name: '中国核电', sector: 'Utilities', marketCap: 165 },
  
  // Transportation
  { symbol: '601111', name: '中国国航', sector: 'Transportation', marketCap: 115 },
  { symbol: '600115', name: '东方航空', sector: 'Transportation', marketCap: 95 },
  { symbol: '600029', name: '南方航空', sector: 'Transportation', marketCap: 105 },
  { symbol: '601006', name: '大秦铁路', sector: 'Transportation', marketCap: 125 },
];

// Market indices
export const AShareIndices = {
  'SH000001': { name: '上证指数', english: 'SSE Composite' },
  'SZ399001': { name: '深证成指', english: 'SZSE Component' },
  'SZ399006': { name: '创业板指', english: 'ChiNext' },
  'SH000300': { name: '沪深300', english: 'CSI 300' },
  'SH000016': { name: '上证50', english: 'SSE 50' },
  'SZ399005': { name: '中小板指', english: 'SME Board' },
};

interface StockQuote {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  turnover: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  marketCap: number;
}

interface IndexData {
  symbol: string;
  name: string;
  english: string;
  price: number;
  change: number;
  changePercent: number;
}

// Generate realistic mock data
const generateMockQuote = (stock: typeof AShareUniverse[0]): StockQuote => {
  const basePrice = 10 + Math.random() * 90;
  const changePercent = (Math.random() - 0.5) * 6; // -3% to +3%
  const change = basePrice * (changePercent / 100);
  const price = basePrice + change;
  
  return {
    symbol: stock.symbol,
    name: stock.name,
    sector: stock.sector,
    price: Number(price.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    volume: Math.floor(Math.random() * 10000000) + 1000000,
    turnover: Math.floor(Math.random() * 1000000000) + 100000000,
    open: Number((basePrice * (1 + (Math.random() - 0.5) * 0.02)).toFixed(2)),
    high: Number((price * 1.02).toFixed(2)),
    low: Number((price * 0.98).toFixed(2)),
    prevClose: Number(basePrice.toFixed(2)),
    marketCap: stock.marketCap,
  };
};

const generateMockIndex = (symbol: string, data: { name: string; english: string }): IndexData => {
  const basePrice = symbol.includes('300') ? 3500 : symbol.includes('50') ? 2500 : 3000;
  const changePercent = (Math.random() - 0.5) * 3;
  const change = basePrice * (changePercent / 100);
  
  return {
    symbol,
    name: data.name,
    english: data.english,
    price: Number((basePrice + change).toFixed(2)),
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
  };
};

// Generate intraday chart data
const generateIntradayData = (basePrice: number) => {
  const data = [];
  let price = basePrice * 0.98;
  
  for (let i = 0; i < 240; i++) { // 4 hours of trading (240 min)
    const change = (Math.random() - 0.48) * 0.5; // Slight upward bias
    price *= (1 + change / 100);
    
    data.push({
      time: `${9 + Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}`,
      price: Number(price.toFixed(2)),
    });
  }
  
  return data;
};

const ASharePage = () => {
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [indices, setIndices] = useState<IndexData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [marketStatus, setMarketStatus] = useState('Market Closed');
  
  // Filters and search
  const [searchQuery, setSearchQuery] = useState('');
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'change' | 'volume' | 'marketCap'>('change');
  
  // Watchlist
  const [watchlist, setWatchlist] = usePersistentState<string[]>('ashare-watchlist', []);
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  
  // Selected stock for detail view
  const [selectedStock, setSelectedStock] = useState<StockQuote | null>(null);
  const [intradayData, setIntradayData] = useState<any[]>([]);

  // Fetch data
  const fetchData = async () => {
    setIsLoading(true);
    
    try {
      // Generate mock data (replace with real API when available)
      const stockQuotes = AShareUniverse.map(generateMockQuote);
      const indexData = Object.entries(AShareIndices).map(([symbol, data]) => 
        generateMockIndex(symbol, data)
      );
      
      setQuotes(stockQuotes);
      setIndices(indexData);
      setLastUpdated(new Date());
      
      // Update market status
      const now = new Date();
      const hour = now.getHours();
      const day = now.getDay();
      
      if (day === 0 || day === 6) {
        setMarketStatus('Market Closed (Weekend)');
      } else if (hour >= 9 && hour < 15) {
        setMarketStatus('Market Open');
      } else if (hour >= 15) {
        setMarketStatus('Market Closed');
      } else {
        setMarketStatus('Pre-market');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  // Update intraday when stock selected
  useEffect(() => {
    if (selectedStock) {
      setIntradayData(generateIntradayData(selectedStock.price));
    }
  }, [selectedStock]);

  // Filter and sort stocks
  const filteredStocks = useMemo(() => {
    let result = quotes;
    
    if (showWatchlistOnly) {
      result = result.filter(s => watchlist.includes(s.symbol));
    }
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(s => 
        s.name.toLowerCase().includes(query) ||
        s.symbol.includes(query) ||
        s.sector.toLowerCase().includes(query)
      );
    }
    
    if (sectorFilter !== 'All') {
      result = result.filter(s => s.sector === sectorFilter);
    }
    
    return result.sort((a, b) => {
      if (sortBy === 'change') return b.changePercent - a.changePercent;
      if (sortBy === 'volume') return b.volume - a.volume;
      if (sortBy === 'marketCap') return b.marketCap - a.marketCap;
      return 0;
    });
  }, [quotes, searchQuery, sectorFilter, sortBy, watchlist, showWatchlistOnly]);

  // Stats
  const stats = useMemo(() => {
    const up = quotes.filter(s => s.change > 0).length;
    const down = quotes.filter(s => s.change < 0).length;
    const flat = quotes.filter(s => s.change === 0).length;
    return { up, down, flat, total: quotes.length };
  }, [quotes]);

  // Unique sectors
  const sectors = useMemo(() => {
    return ['All', ...new Set(AShareUniverse.map(s => s.sector))];
  }, []);

  const toggleWatchlist = (symbol: string) => {
    setWatchlist(prev => 
      prev.includes(symbol) 
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol]
    );
  };

  const formatNumber = (num: number) => {
    if (num >= 100000000) return `${(num / 100000000).toFixed(1)}亿`;
    if (num >= 10000) return `${(num / 10000).toFixed(1)}万`;
    return num.toString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-red-600 to-red-700 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Globe className="w-6 h-6" />
              <h1 className="text-2xl font-bold">A-Share Market</h1>
            </div>
            <p className="text-red-100">Shanghai (SSE) & Shenzhen (SZSE) | Top 50 by Market Cap</p>
          </div>
          
          <div className="text-right">
            <div className="flex items-center gap-2 text-red-100 mb-1">
              <Clock className="w-4 h-4" />
              <span>{marketStatus}</span>
            </div>
            {lastUpdated && (
              <p className="text-sm text-red-200">
                Updated: {lastUpdated.toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-4">
            <div className="bg-white/10 rounded-lg px-4 py-2">
              <p className="text-sm text-red-100">Stocks Tracked</p>
              <p className="text-2xl font-bold">{AShareUniverse.length}</p>
            </div>
            <div className="bg-white/10 rounded-lg px-4 py-2">
              <p className="text-sm text-red-100">Advancing</p>
              <p className="text-2xl font-bold text-green-300">{stats.up}</p>
            </div>
            <div className="bg-white/10 rounded-lg px-4 py-2">
              <p className="text-sm text-red-100">Declining</p>
              <p className="text-2xl font-bold text-green-300">{stats.down}</p>
            </div>
          </div>
          
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Market Indices */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {indices.map((index) => (
          <div key={index.symbol} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <p className="text-xs text-slate-500">{index.english}</p>
            <p className="text-sm font-medium text-slate-800">{index.name}</p>
            <p className="text-lg font-bold text-slate-800">{index.price.toFixed(2)}</p>
            <div className={`flex items-center gap-1 text-xs ${index.change >= 0 ? 'text-red-600' : 'text-green-600'}`}>
              {index.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span>{index.change >= 0 ? '+' : ''}{index.changePercent.toFixed(2)}%</span>
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
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {sectors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-slate-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="change">Sort by Change %</option>
              <option value="volume">Sort by Volume</option>
              <option value="marketCap">Sort by Market Cap</option>
            </select>
          </div>
          
          <label className="flex items-center gap-2 cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={showWatchlistOnly}
              onChange={(e) => setShowWatchlistOnly(e.target.checked)}
              className="rounded border-slate-300 text-red-600 focus:ring-red-500"
            />
            <span className="text-sm text-slate-600">Watchlist only ({watchlist.length})</span>
          </label>
        </div>
      </div>

      {/* Stock Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">
            {showWatchlistOnly ? 'My Watchlist' : 'All Stocks'} 
            <span className="text-sm font-normal text-slate-500 ml-2">({filteredStocks.length})</span>
          </h2>
        </div>
        
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Stock</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Sector</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">Price</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">Change</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">Volume</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">Cap</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-slate-500">Action</th>
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
                    ¥{stock.price.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className={`flex items-center justify-end gap-1 ${stock.change >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {stock.change >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      <span className="font-medium">{stock.change >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600 text-sm">
                    {formatNumber(stock.volume)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600 text-sm">
                    {stock.marketCap}B
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWatchlist(stock.symbol);
                      }}
                      className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors"
                    >
                      {watchlist.includes(stock.symbol) ? (
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
                <h2 className="text-2xl font-bold text-slate-800">{selectedStock.name}</h2>
                <p className="text-slate-500">{selectedStock.symbol} • {selectedStock.sector}</p>
              </div>
              <button
                onClick={() => setSelectedStock(null)}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                ×
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Price Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-sm text-slate-500">Current Price</p>
                  <p className="text-2xl font-bold text-slate-800">¥{selectedStock.price.toFixed(2)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-sm text-slate-500">Change</p>
                  <p className={`text-2xl font-bold ${selectedStock.change >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {selectedStock.change >= 0 ? '+' : ''}{selectedStock.changePercent.toFixed(2)}%
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-sm text-slate-500">Volume</p>
                  <p className="text-xl font-bold text-slate-800">{formatNumber(selectedStock.volume)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-sm text-slate-500">Market Cap</p>
                  <p className="text-xl font-bold text-slate-800">¥{selectedStock.marketCap}B</p>
                </div>
              </div>
              
              {/* Intraday Chart */}
              <div>
                <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Intraday Chart
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={intradayData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke="#64748b" />
                      <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12 }} stroke="#64748b" />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="price" 
                        stroke="#ef4444" 
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              
              {/* OHLC */}
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-500">Open</p>
                  <p className="font-semibold text-slate-800">¥{selectedStock.open.toFixed(2)}</p>
                </div>
                <div className="text-center p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-500">High</p>
                  <p className="font-semibold text-slate-800">¥{selectedStock.high.toFixed(2)}</p>
                </div>
                <div className="text-center p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-500">Low</p>
                  <p className="font-semibold text-slate-800">¥{selectedStock.low.toFixed(2)}</p>
                </div>
                <div className="text-center p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-500">Prev Close</p>
                  <p className="font-semibold text-slate-800">¥{selectedStock.prevClose.toFixed(2)}</p>
                </div>
              </div>
              
              {/* Watchlist Button */}
              <button
                onClick={() => toggleWatchlist(selectedStock.symbol)}
                className={`w-full py-3 rounded-lg font-medium flex items-center justify-center gap-2 ${
                  watchlist.includes(selectedStock.symbol)
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {watchlist.includes(selectedStock.symbol) ? (
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
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium mb-1">Data Source Notice</p>
            <p>
              Currently displaying simulated market data. Real-time A-share data requires 
              a market data subscription (e.g., Sina Finance API with proper licensing). 
              Contact your broker for live data feeds.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ASharePage;
