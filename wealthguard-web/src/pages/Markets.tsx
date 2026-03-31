import { useState, useEffect, useMemo } from 'react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';
import { 
  TrendingUp, TrendingDown, Clock, RefreshCw, AlertCircle,
  Search, Filter, Star, StarOff, ArrowUpRight, ArrowDownRight,
  Activity
} from 'lucide-react';
import { usePersistentState } from '../hooks/usePersistentState';

// A-Share Universe - Top 50 with English primary names
export const AShareUniverse = [
  // Financials
  { symbol: '600519', name: 'Kweichow Moutai', cnName: '贵州茅台', sector: 'Consumer Staples', marketCap: 2100 },
  { symbol: '601318', name: 'Ping An Insurance', cnName: '中国平安', sector: 'Financials', marketCap: 850 },
  { symbol: '600036', name: 'China Merchants Bank', cnName: '招商银行', sector: 'Financials', marketCap: 720 },
  { symbol: '601166', name: 'Industrial Bank', cnName: '兴业银行', sector: 'Financials', marketCap: 320 },
  { symbol: '601398', name: 'ICBC', cnName: '工商银行', sector: 'Financials', marketCap: 1800 },
  { symbol: '601288', name: 'Agricultural Bank', cnName: '农业银行', sector: 'Financials', marketCap: 1200 },
  { symbol: '601988', name: 'Bank of China', cnName: '中国银行', sector: 'Financials', marketCap: 980 },
  { symbol: '601628', name: 'China Life', cnName: '中国人寿', sector: 'Financials', marketCap: 780 },
  { symbol: '600030', name: 'CITIC Securities', cnName: '中信证券', sector: 'Financials', marketCap: 280 },
  
  // Consumer
  { symbol: '000858', name: 'Wuliangye', cnName: '五粮液', sector: 'Consumer Staples', marketCap: 520 },
  { symbol: '002594', name: 'BYD', cnName: '比亚迪', sector: 'Consumer Discretionary', marketCap: 680 },
  { symbol: '601888', name: 'China Tourism', cnName: '中国中免', sector: 'Consumer Discretionary', marketCap: 180 },
  { symbol: '600887', name: 'Yili Group', cnName: '伊利股份', sector: 'Consumer Staples', marketCap: 165 },
  { symbol: '603288', name: 'Haitian Flavouring', cnName: '海天味业', sector: 'Consumer Staples', marketCap: 210 },
  { symbol: '000333', name: 'Midea Group', cnName: '美的集团', sector: 'Consumer Discretionary', marketCap: 420 },
  { symbol: '000651', name: 'Gree Electric', cnName: '格力电器', sector: 'Consumer Discretionary', marketCap: 195 },
  { symbol: '002475', name: 'Luxshare Precision', cnName: '立讯精密', sector: 'Technology', marketCap: 280 },
  
  // Technology
  { symbol: '300750', name: 'CATL', cnName: '宁德时代', sector: 'Technology', marketCap: 890 },
  { symbol: '002371', name: 'NAURA', cnName: '北方华创', sector: 'Technology', marketCap: 195 },
  { symbol: '603501', name: 'Will Semi', cnName: '韦尔股份', sector: 'Technology', marketCap: 115 },
  { symbol: '300760', name: 'Mindray Medical', cnName: '迈瑞医疗', sector: 'Healthcare', marketCap: 340 },
  { symbol: '300059', name: 'East Money', cnName: '东方财富', sector: 'Financials', marketCap: 220 },
  { symbol: '002230', name: 'iFlytek', cnName: '科大讯飞', sector: 'Technology', marketCap: 110 },
  { symbol: '688981', name: 'SMIC', cnName: '中芯国际', sector: 'Technology', marketCap: 420 },
  { symbol: '688111', name: 'Kingsoft Office', cnName: '金山办公', sector: 'Technology', marketCap: 125 },
  
  // Healthcare
  { symbol: '600276', name: 'Hengrui Medicine', cnName: '恒瑞医药', sector: 'Healthcare', marketCap: 280 },
  { symbol: '603259', name: 'WuXi AppTec', cnName: '药明康德', sector: 'Healthcare', marketCap: 145 },
  { symbol: '000538', name: 'Yunnan Baiyao', cnName: '云南白药', sector: 'Healthcare', marketCap: 98 },
  { symbol: '600436', name: 'Pien Tze Huang', cnName: '片仔癀', sector: 'Healthcare', marketCap: 135 },
  
  // Energy & Materials
  { symbol: '601088', name: 'China Shenhua', cnName: '中国神华', sector: 'Energy', marketCap: 750 },
  { symbol: '600028', name: 'Sinopec', cnName: '中国石化', sector: 'Energy', marketCap: 720 },
  { symbol: '601857', name: 'PetroChina', cnName: '中国石油', sector: 'Energy', marketCap: 1450 },
  { symbol: '601899', name: 'Zijin Mining', cnName: '紫金矿业', sector: 'Materials', marketCap: 420 },
  { symbol: '600309', name: 'Wanhua Chemical', cnName: '万华化学', sector: 'Materials', marketCap: 240 },
  
  // Industrials
  { symbol: '601012', name: 'LONGi Green Energy', cnName: '隆基绿能', sector: 'Industrials', marketCap: 110 },
  { symbol: '601668', name: 'CSCEC', cnName: '中国建筑', sector: 'Industrials', marketCap: 210 },
  { symbol: '601390', name: 'CREC', cnName: '中国中铁', sector: 'Industrials', marketCap: 145 },
  
  // Telecom & Utilities
  { symbol: '600941', name: 'China Mobile', cnName: '中国移动', sector: 'Telecom', marketCap: 2200 },
  { symbol: '600050', name: 'China Unicom', cnName: '中国联通', sector: 'Telecom', marketCap: 145 },
  { symbol: '601728', name: 'China Telecom', cnName: '中国电信', sector: 'Telecom', marketCap: 520 },
  { symbol: '600900', name: 'Yangtze Power', cnName: '长江电力', sector: 'Utilities', marketCap: 680 },
];

// Market indices - English primary
export const AShareIndices = {
  'SH000001': { name: 'SSE Composite', cnName: '上证指数' },
  'SZ399001': { name: 'SZSE Component', cnName: '深证成指' },
  'SZ399006': { name: 'ChiNext Index', cnName: '创业板指' },
  'SH000300': { name: 'CSI 300', cnName: '沪深300' },
  'SH000016': { name: 'SSE 50', cnName: '上证50' },
};

// US Market data (mock - replace with real API)
export const USStocks = [
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', price: 225.50, change: 1.25 },
  { symbol: 'MSFT', name: 'Microsoft', sector: 'Technology', price: 420.80, change: 0.85 },
  { symbol: 'NVDA', name: 'NVIDIA', sector: 'Technology', price: 138.20, change: 3.45 },
  { symbol: 'GOOGL', name: 'Alphabet', sector: 'Technology', price: 178.90, change: -0.45 },
  { symbol: 'AMZN', name: 'Amazon', sector: 'Consumer', price: 198.40, change: 1.10 },
  { symbol: 'META', name: 'Meta', sector: 'Technology', price: 595.20, change: 2.30 },
  { symbol: 'TSLA', name: 'Tesla', sector: 'Consumer', price: 268.30, change: -2.15 },
  { symbol: 'BRK.B', name: 'Berkshire', sector: 'Financials', price: 458.60, change: 0.35 },
  { symbol: 'JPM', name: 'JPMorgan', sector: 'Financials', price: 245.80, change: 0.95 },
  { symbol: 'V', name: 'Visa', sector: 'Financials', price: 315.40, change: 0.65 },
];

export const USIndices = {
  'SPX': { name: 'S&P 500', price: 5580.25, change: 0.75 },
  'DJI': { name: 'Dow Jones', price: 42150.80, change: 0.45 },
  'IXIC': { name: 'NASDAQ', price: 17890.60, change: 1.25 },
  'RUT': { name: 'Russell 2000', price: 2025.40, change: -0.35 },
  'VIX': { name: 'VIX', price: 14.20, change: -2.15 },
};

// ASX Market data (mock - replace with real API)
export const ASXStocks = [
  { symbol: 'CBA', name: 'Commonwealth Bank', sector: 'Financials', price: 158.20, change: 0.85, yield: 4.2 },
  { symbol: 'BHP', name: 'BHP Group', sector: 'Materials', price: 42.80, change: -0.45, yield: 5.8 },
  { symbol: 'RIO', name: 'Rio Tinto', sector: 'Materials', price: 118.50, change: 0.65, yield: 4.2 },
  { symbol: 'NAB', name: 'NAB', sector: 'Financials', price: 38.90, change: 0.35, yield: 5.5 },
  { symbol: 'WBC', name: 'Westpac', sector: 'Financials', price: 32.40, change: 0.25, yield: 5.8 },
  { symbol: 'ANZ', name: 'ANZ Bank', sector: 'Financials', price: 32.10, change: 0.40, yield: 4.8 },
  { symbol: 'WES', name: 'Wesfarmers', sector: 'Consumer', price: 68.50, change: 0.55, yield: 3.2 },
  { symbol: 'WOW', name: 'Woolworths', sector: 'Consumer', price: 35.20, change: -0.15, yield: 3.5 },
  { symbol: 'TLS', name: 'Telstra', sector: 'Telecom', price: 3.85, change: 0.05, yield: 4.2 },
  { symbol: 'TCL', name: 'Transurban', sector: 'Industrials', price: 12.80, change: 0.10, yield: 4.6 },
  { symbol: 'CSL', name: 'CSL Limited', sector: 'Healthcare', price: 285.60, change: 1.25, yield: 1.8 },
  { symbol: 'FMG', name: 'Fortescue', sector: 'Materials', price: 18.90, change: -0.35, yield: 7.2 },
];

export const ASXIndices = {
  'XJO': { name: 'ASX 200', price: 7850.40, change: 0.55 },
  'XKO': { name: 'ASX 300', price: 7855.20, change: 0.52 },
  'XAO': { name: 'All Ordinaries', price: 8125.80, change: 0.48 },
};

interface StockQuote {
  symbol: string;
  name: string;
  cnName?: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: number;
  yield?: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
}

interface MarketIndex {
  symbol: string;
  name: string;
  cnName?: string;
  price: number;
  change: number;
  changePercent: number;
}

type MarketRegion = 'US' | 'AU' | 'CN';

// Generate mock data
const generateMockQuote = (stock: any): StockQuote => {
  const basePrice = stock.price || (10 + Math.random() * 90);
  const changePercent = (Math.random() - 0.5) * 4;
  const change = basePrice * (changePercent / 100);
  const price = basePrice + change;
  
  return {
    symbol: stock.symbol,
    name: stock.name,
    cnName: stock.cnName,
    sector: stock.sector,
    price: Number(price.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    volume: Math.floor(Math.random() * 10000000) + 1000000,
    marketCap: stock.marketCap || Math.floor(Math.random() * 500) + 50,
    yield: stock.yield,
    high: Number((price * 1.015).toFixed(2)),
    low: Number((price * 0.985).toFixed(2)),
    open: Number((basePrice * (1 + (Math.random() - 0.5) * 0.01)).toFixed(2)),
    prevClose: Number(basePrice.toFixed(2)),
  };
};

const generateIntradayData = (basePrice: number) => {
  const data = [];
  let price = basePrice * 0.98;
  
  for (let i = 0; i < 240; i++) {
    const change = (Math.random() - 0.48) * 0.3;
    price *= (1 + change / 100);
    
    data.push({
      time: `${9 + Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}`,
      price: Number(price.toFixed(2)),
    });
  }
  
  return data;
};

const MultiMarketPage = () => {
  const [activeMarket, setActiveMarket] = useState<MarketRegion>('AU');
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'change' | 'volume' | 'marketCap' | 'yield'>('change');
  
  const [watchlist, setWatchlist] = usePersistentState<string[]>('multimarket-watchlist', []);
  const [selectedStock, setSelectedStock] = useState<StockQuote | null>(null);
  const [intradayData, setIntradayData] = useState<any[]>([]);

  const fetchData = async () => {
    setIsLoading(true);
    
    try {
      let stockQuotes: StockQuote[] = [];
      let indexData: MarketIndex[] = [];
      
      switch (activeMarket) {
        case 'CN':
          stockQuotes = AShareUniverse.map(generateMockQuote);
          indexData = Object.entries(AShareIndices).map(([symbol, data]) => ({
            symbol,
            name: data.name,
            cnName: data.cnName,
            price: 3000 + (Math.random() - 0.5) * 200,
            change: (Math.random() - 0.5) * 50,
            changePercent: (Math.random() - 0.5) * 2,
          }));
          break;
          
        case 'US':
          stockQuotes = USStocks.map(generateMockQuote);
          indexData = Object.entries(USIndices).map(([symbol, data]) => ({
            symbol,
            name: data.name,
            price: data.price,
            change: data.price * (data.change / 100),
            changePercent: data.change,
          }));
          break;
          
        case 'AU':
          stockQuotes = ASXStocks.map(generateMockQuote);
          indexData = Object.entries(ASXIndices).map(([symbol, data]) => ({
            symbol,
            name: data.name,
            price: data.price,
            change: data.price * (data.change / 100),
            changePercent: data.change,
          }));
          break;
      }
      
      setQuotes(stockQuotes);
      setIndices(indexData);
      setLastUpdated(new Date());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [activeMarket]);

  useEffect(() => {
    if (selectedStock) {
      setIntradayData(generateIntradayData(selectedStock.price));
    }
  }, [selectedStock]);

  const filteredStocks = useMemo(() => {
    let result = quotes;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(s => 
        s.name.toLowerCase().includes(query) ||
        s.symbol.toLowerCase().includes(query) ||
        s.sector.toLowerCase().includes(query) ||
        (s.cnName && s.cnName.includes(query))
      );
    }
    
    if (sectorFilter !== 'All') {
      result = result.filter(s => s.sector === sectorFilter);
    }
    
    return result.sort((a, b) => {
      if (sortBy === 'change') return b.changePercent - a.changePercent;
      if (sortBy === 'volume') return b.volume - a.volume;
      if (sortBy === 'marketCap') return b.marketCap - a.marketCap;
      if (sortBy === 'yield') return (b.yield || 0) - (a.yield || 0);
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
  };

  const config = marketConfig[activeMarket];

  return (
    <div className="space-y-6">
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
                    : 'bg-red-100 text-red-700'
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
        : 'from-red-600 to-red-700'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-3xl">{config.flag}</span>
              <h1 className="text-2xl font-bold">{config.name}</h1>
            </div>
            <p className="opacity-80">{config.hours} | {quotes.length} stocks tracked</p>
          </div>
          
          <div className="text-right">
            <div className="flex items-center gap-2 opacity-80 mb-1">
              <Clock className="w-4 h-4" />
              <span>{lastUpdated?.toLocaleTimeString() || 'Loading...'}</span>
            </div>
            <button
              onClick={fetchData}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
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
            {index.cnName && <p className="text-xs text-slate-500">{index.cnName}</p>}
            <p className="text-lg font-bold text-slate-800 mt-1">{config.currency}{index.price.toFixed(2)}</p>
            <div className={`flex items-center gap-1 text-sm ${index.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {index.change >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
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
            {activeMarket === 'AU' && <option value="yield">Sort by Dividend Yield</option>}
          </select>
        </div>
      </div>

      {/* Stock Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">
            {activeMarket === 'CN' ? 'China A-Share Top 50' : activeMarket === 'AU' ? 'ASX Top Stocks' : 'US Large Cap'}
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
                {activeMarket === 'AU' && <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">Yield</th>}
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">Volume</th>
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
                      {stock.cnName && <p className="text-xs text-slate-400">{stock.cnName}</p>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-1 bg-slate-100 rounded-full text-slate-600">
                      {stock.sector}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-800">
                    {config.currency}{stock.price.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className={`flex items-center justify-end gap-1 ${stock.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {stock.change >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      <span className="font-medium">{stock.change >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%</span>
                    </div>
                  </td>
                  {activeMarket === 'AU' && (
                    <td className="px-4 py-3 text-right text-slate-600 text-sm">
                      {stock.yield ? `${stock.yield}%` : '-'}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right text-slate-600 text-sm">
                    {(stock.volume / 1000000).toFixed(1)}M
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
                <h2 className="text-2xl font-bold text-slate-800">{selectedStock.name}</h2>
                <p className="text-slate-500">{selectedStock.symbol} • {selectedStock.sector}</p>
                {selectedStock.cnName && <p className="text-sm text-slate-400">{selectedStock.cnName}</p>}
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
                  <p className="text-2xl font-bold text-slate-800">{config.currency}{selectedStock.price.toFixed(2)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-sm text-slate-500">Change</p>
                  <p className={`text-2xl font-bold ${selectedStock.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {selectedStock.change >= 0 ? '+' : ''}{selectedStock.changePercent.toFixed(2)}%
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-sm text-slate-500">Volume</p>
                  <p className="text-xl font-bold text-slate-800">{(selectedStock.volume / 1000000).toFixed(1)}M</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-sm text-slate-500">Market Cap</p>
                  <p className="text-xl font-bold text-slate-800">${selectedStock.marketCap}B</p>
                </div>
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
                          <stop offset="5%" stopColor={activeMarket === 'US' ? '#3b82f6' : activeMarket === 'AU' ? '#22c55e' : '#ef4444'} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={activeMarket === 'US' ? '#3b82f6' : activeMarket === 'AU' ? '#22c55e' : '#ef4444'} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke="#64748b" />
                      <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12 }} stroke="#64748b" />
                      <Tooltip contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                      <Area 
                        type="monotone" 
                        dataKey="price" 
                        stroke={activeMarket === 'US' ? '#3b82f6' : activeMarket === 'AU' ? '#22c55e' : '#ef4444'}
                        fillOpacity={1} 
                        fill="url(#colorPrice)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-500">Open</p>
                  <p className="font-semibold text-slate-800">{config.currency}{selectedStock.open.toFixed(2)}</p>
                </div>
                <div className="text-center p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-500">High</p>
                  <p className="font-semibold text-slate-800">{config.currency}{selectedStock.high.toFixed(2)}</p>
                </div>
                <div className="text-center p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-500">Low</p>
                  <p className="font-semibold text-slate-800">{config.currency}{selectedStock.low.toFixed(2)}</p>
                </div>
                <div className="text-center p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs text-slate-500">Prev Close</p>
                  <p className="font-semibold text-slate-800">{config.currency}{selectedStock.prevClose.toFixed(2)}</p>
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
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium mb-1">Market Data Notice</p>
            <p>
              Displaying simulated market data for demonstration. Connect to real APIs for live prices:
              US (Alpha Vantage/Yahoo Finance), AU (ASX API), CN (Sina Finance).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MultiMarketPage;
