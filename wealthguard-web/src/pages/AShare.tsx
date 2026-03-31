import { useState, useEffect } from 'react';
import { 
  Globe, TrendingUp, TrendingDown, Clock,
  RefreshCw, AlertCircle
} from 'lucide-react';
import { 
  fetchAShareQuotes, 
  fetchAShareIndex, 
  analyzeAShare,
  AShareBlueChips,
  AShareIndices,
  getMarketStatus,
  type AShareQuote,
  type SignalAnalysis
} from '../services/ashare/ashareService';

const ASharePage = () => {
  const [quotes, setQuotes] = useState<AShareQuote[]>([]);
  const [indices, setIndices] = useState<any[]>([]);
  const [analyses, setAnalyses] = useState<SignalAnalysis[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [marketStatus, setMarketStatus] = useState(getMarketStatus());

  // Fetch data
  const fetchData = async () => {
    setIsLoading(true);
    
    try {
      // Fetch indices
      const indexSymbols = Object.keys(AShareIndices);
      const indexPromises = indexSymbols.map(s => fetchAShareIndex(s));
      const indexData = (await Promise.all(indexPromises)).filter(Boolean);
      setIndices(indexData);
      
      // Fetch blue chip stocks
      const stockSymbols = AShareBlueChips.map(s => s.symbol);
      const quoteData = await fetchAShareQuotes(stockSymbols);
      setQuotes(quoteData);
      
      // Analyze signals
      const signalData = quoteData.map(analyzeAShare);
      setAnalyses(signalData);
      
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch A-share data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      setMarketStatus(getMarketStatus());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

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
            <p className="text-red-100">Shanghai (SSE) & Shenzhen (SZSE) Real-time Quotes</p>
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
              <p className="text-sm text-red-100">Blue Chips Tracked</p>
              <p className="text-2xl font-bold">{AShareBlueChips.length}</p>
            </div>
            <div className="bg-white/10 rounded-lg px-4 py-2">
              <p className="text-sm text-red-100">Buy Signals</p>
              <p className="text-2xl font-bold text-green-300">{analyses.filter(a => a.signal === 'BUY').length}</p>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {indices.map((index) => (
          <div key={index.symbol} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <p className="text-sm text-slate-500">{index.name}</p>
            <p className="text-xl font-bold text-slate-800">{index.price.toFixed(2)}</p>
            <div className={`flex items-center gap-1 text-sm ${index.change >= 0 ? 'text-red-600' : 'text-green-600'}`}>
              {index.change >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              <span>{index.change >= 0 ? '+' : ''}{index.changePercent.toFixed(2)}%</span>
            </div>
          </div>
        ))}
      </div>

      {/* Stock Quotes Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Blue Chip Analysis</h2>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">Stock</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-slate-600">Price</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-slate-600">Change</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-slate-600">Volume</th>
                <th className="text-center px-4 py-3 text-sm font-medium text-slate-600">Signal</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-slate-600">Analysis</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote) => {
                const analysis = analyses.find(a => a.symbol === quote.symbol);
                
                return (
                  <tr key={quote.symbol} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-slate-800">{quote.name}</p>
                        <p className="text-sm text-slate-500">{quote.symbol}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-medium text-slate-800">¥{quote.price.toFixed(2)}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className={`flex items-center justify-end gap-1 ${quote.change >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {quote.change >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        <span>{quote.change >= 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {(quote.volume / 10000).toFixed(0)}万
                    </td>
                    <td className="px-4 py-3 text-center">
                      {analysis && (
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          analysis.signal === 'BUY' ? 'bg-red-100 text-red-700' :
                          analysis.signal === 'SELL' ? 'bg-green-100 text-green-700' :
                          analysis.signal === 'HOLD' ? 'bg-blue-100 text-blue-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {analysis.signal}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {analysis && (
                        <div className="text-sm text-slate-600">
                          <p className="font-medium mb-1">Score: {analysis.score}/100</p>
                          {analysis.reasons.slice(0, 2).map((reason, i) => (
                            <p key={i} className="text-xs text-slate-500">• {reason}</p>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium mb-1">Disclaimer</p>
            <p>
              A-share market data is for informational purposes only. Trading signals are based on 
              simple technical analysis and should not be considered as investment advice. 
              Past performance does not guarantee future results. Please conduct your own research 
              before making investment decisions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ASharePage;
