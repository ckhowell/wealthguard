import { useState, useEffect, useCallback } from 'react';
import { 
  TrendingUp, AlertTriangle, CheckCircle, Info,
  ArrowUpRight, Percent, Loader2,
  Building2, DollarSign,
  Target, Shield, Zap
} from 'lucide-react';

interface Opportunity {
  id: string;
  symbol: string;
  name: string;
  type: 'stock' | 'etf' | 'crypto';
  exchange: string;
  yield: number;
  franking?: number;
  price: number;
  priceAud?: number;
  change24h?: number;
  thesis: string;
  risks: string[];
  recommendation: 'buy' | 'hold' | 'avoid' | 'watch';
  category: 'income' | 'growth' | 'defensive' | 'speculative';
  tags: string[];
  conviction: number;
}

interface PortfolioHolding {
  symbol: string;
  asset_name: string;
  shares: number;
  current_price: number;
  value_aud: number;
  asset_class: string;
  sector?: string;
}

interface PortfolioWarning {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  message: string;
  suggestion: string;
  actionType?: 'rebalance' | 'diversify' | 'exit' | 'hold';
}

const ASX_OPPORTUNITIES: Omit<Opportunity, 'price' | 'priceAud' | 'change24h'>[] = [
  {
    id: '1',
    symbol: 'ANZ.AX',
    name: 'ANZ Group Holdings',
    type: 'stock',
    exchange: 'ASX',
    yield: 4.55,
    franking: 70,
    thesis: 'Quiet winner in 2025, up 40% since April. Trading at discount to NAB/Westpac despite strong capital position. New CEO making smart divestments.',
    risks: ['Exposure to commercial real estate', 'Competition from neobanks', 'Interest rate sensitivity'],
    recommendation: 'buy',
    category: 'income',
    tags: ['dividend', 'banking', 'blue-chip', 'franked'],
    conviction: 8
  },
  {
    id: '2',
    symbol: 'RIO.AX',
    name: 'Rio Tinto',
    type: 'stock',
    exchange: 'ASX',
    yield: 4.2,
    franking: 100,
    thesis: 'Commodity exposure without crypto volatility. Iron ore cash machine, lithium pivot for EV transition. 100% franking makes yield tax-efficient.',
    risks: ['China demand dependency', 'Commodity price cycles', 'ESG pressures'],
    recommendation: 'buy',
    category: 'income',
    tags: ['mining', 'commodities', 'fully-franked', 'dividend'],
    conviction: 9
  },
  {
    id: '3',
    symbol: 'TCL.AX',
    name: 'Transurban Group',
    type: 'stock',
    exchange: 'ASX',
    yield: 4.62,
    franking: 0,
    thesis: 'Toll roads = inflation-linked recurring revenue. Monopoly assets in Melbourne, Sydney, Brisbane. Steady cashflows regardless of economic cycles.',
    risks: ['Interest rate sensitivity (high debt)', 'Traffic volume risk', 'Regulatory changes'],
    recommendation: 'buy',
    category: 'defensive',
    tags: ['infrastructure', 'toll-roads', 'recurring-revenue'],
    conviction: 7
  },
  {
    id: '4',
    symbol: 'WES.AX',
    name: 'Wesfarmers',
    type: 'stock',
    exchange: 'ASX',
    yield: 3.1,
    franking: 100,
    thesis: 'Bunnings + Kmart + Officeworks = exposure to resilient consumer spending. Strong management, consistent dividend growth.',
    risks: ['Consumer spending slowdown', 'Amazon competition', 'Retail cyclicality'],
    recommendation: 'watch',
    category: 'growth',
    tags: ['retail', 'consumer', 'fully-franked'],
    conviction: 6
  },
  {
    id: '5',
    symbol: 'VAS.AX',
    name: 'Vanguard Australian Shares ETF',
    type: 'etf',
    exchange: 'ASX',
    yield: 3.8,
    franking: 70,
    thesis: 'Instant diversification across ASX 300. Low fees (0.10%), passive management. Good for deploying cash without picking individual stocks.',
    risks: ['Market beta exposure', 'Concentration in banks/materials', 'No downside protection'],
    recommendation: 'buy',
    category: 'growth',
    tags: ['etf', 'diversified', 'passive', 'franked'],
    conviction: 8
  },
  {
    id: '6',
    symbol: 'CBA.AX',
    name: 'Commonwealth Bank',
    type: 'stock',
    exchange: 'ASX',
    yield: 3.8,
    franking: 100,
    thesis: 'Market leader in Australian banking. Strong digital platform, dominant market share. Premium valuation but quality franchise.',
    risks: ['Premium valuation', 'Housing market exposure', 'Regulatory pressure'],
    recommendation: 'hold',
    category: 'income',
    tags: ['banking', 'blue-chip', 'fully-franked'],
    conviction: 7
  }
];

const OpportunityCard = ({ opp }: { opp: Opportunity }) => {
  const [expanded, setExpanded] = useState(false);
  
  const getRecColor = (rec: string) => {
    switch (rec) {
      case 'buy': return 'bg-green-100 text-green-800 border-green-200';
      case 'hold': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'avoid': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    }
  };

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case 'income': return 'bg-purple-100 text-purple-800';
      case 'growth': return 'bg-blue-100 text-blue-800';
      case 'defensive': return 'bg-green-100 text-green-800';
      default: return 'bg-orange-100 text-orange-800';
    }
  };

  const getConvictionDots = (conviction: number) => {
    return (
      <div className="flex gap-0.5">
        {[...Array(10)].map((_, i) => (
          <div
            key={i}
            className={`w-1.5 h-1.5 rounded-full ${i < conviction ? 'bg-blue-500' : 'bg-slate-200'}`}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-bold text-slate-800">{opp.symbol.replace('.AX', '')}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${getRecColor(opp.recommendation)}`}>
                {opp.recommendation.toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-slate-500">{opp.name}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-slate-800">
              {opp.price > 0 ? `A$${opp.price.toFixed(2)}` : 'Loading...'}
            </p>
            {opp.change24h !== undefined && (
              <p className={`text-xs ${opp.change24h >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {opp.change24h >= 0 ? '+' : ''}{opp.change24h.toFixed(2)}%
              </p>
            )}
            <p className="text-xs text-slate-500">{opp.exchange}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <span className={`text-xs px-2 py-1 rounded-full ${getCategoryColor(opp.category)}`}>
            {opp.category}
          </span>
          <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600 flex items-center gap-1">
            <Percent className="w-3 h-3" />
            {opp.yield}% yield
          </span>
          {opp.franking !== undefined && opp.franking > 0 && (
            <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700">
              {opp.franking}% franked
            </span>
          )}
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-500">Conviction</span>
            {getConvictionDots(opp.conviction)}
          </div>
        </div>

        <p className="text-sm text-slate-600 mb-3 line-clamp-2">{opp.thesis}</p>

        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <h4 className="text-sm font-semibold text-slate-700 mb-2">Key Risks</h4>
            <ul className="space-y-1 mb-4">
              {opp.risks.map((risk, i) => (
                <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  {risk}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-1">
              {opp.tags.map(tag => (
                <span key={tag} className="text-xs px-2 py-0.5 rounded bg-slate-50 text-slate-500">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const WarningCard = ({ warning }: { warning: PortfolioWarning }) => {
  const getSeverityColor = (sev: string) => {
    switch (sev) {
      case 'high': return 'border-red-500 bg-red-50';
      case 'medium': return 'border-amber-500 bg-amber-50';
      default: return 'border-blue-500 bg-blue-50';
    }
  };

  const getSeverityIcon = (sev: string) => {
    switch (sev) {
      case 'high': return <AlertTriangle className="w-5 h-5 text-red-600" />;
      case 'medium': return <Info className="w-5 h-5 text-amber-600" />;
      default: return <CheckCircle className="w-5 h-5 text-blue-600" />;
    }
  };

  return (
    <div className={`rounded-xl border-l-4 p-4 ${getSeverityColor(warning.severity)}`}>
      <div className="flex items-start gap-3">
        {getSeverityIcon(warning.severity)}
        <div className="flex-1">
          <h4 className="font-semibold text-slate-800 mb-1">{warning.title}</h4>
          <p className="text-sm text-slate-600 mb-2">{warning.message}</p>
          <div className="flex items-start gap-2 text-sm">
            <ArrowUpRight className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <span className="text-slate-700 font-medium">{warning.suggestion}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const Advisor = () => {
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [portfolioWarnings, setPortfolioWarnings] = useState<PortfolioWarning[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Generate warnings based on portfolio data
  const generateWarnings = useCallback((holdings: PortfolioHolding[], totalValue: number): PortfolioWarning[] => {
    const warnings: PortfolioWarning[] = [];
    
    const realEstateValue = holdings
      .filter(h => h.asset_class === 'alternative' && !h.symbol?.includes('VEHICLE'))
      .reduce((sum, h) => sum + h.value_aud, 0);
    
    const cryptoHoldings = holdings.filter(h => h.asset_class === 'crypto');
    
    const cashValue = holdings
      .filter(h => h.asset_class === 'cash' || h.asset_class === 'current_account')
      .reduce((sum, h) => sum + h.value_aud, 0);
    
    const stockValue = holdings
      .filter(h => h.asset_class === 'equity')
      .reduce((sum, h) => sum + h.value_aud, 0);
    
    const rePct = (realEstateValue / totalValue) * 100;
    const cashPct = (cashValue / totalValue) * 100;
    const stockPct = (stockValue / totalValue) * 100;
    
    // Real estate concentration
    if (rePct > 50) {
      warnings.push({
        id: 'concentration',
        severity: 'high',
        title: 'Real Estate Concentration',
        message: `${rePct.toFixed(1)}% of net worth ($${(realEstateValue/1000000).toFixed(2)}M) is in real estate. This creates liquidity risk.`,
        suggestion: `Deploy $${Math.min(cashValue * 0.5, 300000).toLocaleString()} from cash into ASX income stocks`,
        actionType: 'diversify'
      });
    }
    
    // SUI risk
    const suiHolding = cryptoHoldings.find(h => h.symbol === 'SUI');
    if (suiHolding && suiHolding.shares > 100) {
      warnings.push({
        id: 'sui-risk',
        severity: 'high',
        title: 'SUI Tokenomics Risk',
        message: `SUI has 55% annual inflation and is down 82% from ATH. Position: ${suiHolding.shares} tokens (~$${suiHolding.value_aud.toLocaleString()}).`,
        suggestion: 'Consider exiting SUI and consolidating to BTC/ETH',
        actionType: 'exit'
      });
    }
    
    // Cash drag
    if (cashPct > 15 && cashValue > 300000) {
      warnings.push({
        id: 'cash-drag',
        severity: 'medium',
        title: 'Cash Drag',
        message: `$${(cashValue/1000).toFixed(0)}K (${cashPct.toFixed(1)}%) earning ~5.15% vs potential 6-8% from dividend portfolio.`,
        suggestion: `Deploy $100K/month into VAS + ANZ + RIO`,
        actionType: 'diversify'
      });
    }
    
    // Stock underweight
    if (stockPct < 5) {
      warnings.push({
        id: 'stock-underweight',
        severity: 'medium',
        title: 'Equity Underweight',
        message: `Only ${stockPct.toFixed(1)}% in equities. Missing growth potential and dividend income.`,
        suggestion: 'Build equity position to 15-20% of portfolio over 12 months',
        actionType: 'diversify'
      });
    }
    
    // Japan FX risk
    const japanProperty = holdings.find(h => h.asset_name?.includes('Japan') || h.asset_name?.includes('Niseko'));
    if (japanProperty) {
      warnings.push({
        id: 'fx-exposure',
        severity: 'low',
        title: 'JPY Property FX Risk',
        message: `$${(japanProperty.value_aud/1000).toFixed(0)}K AUD equivalent in Japan. JPY at historic lows.`,
        suggestion: 'Consider as diversification play',
        actionType: 'hold'
      });
    }
    
    return warnings;
  }, []);

  // Fetch live data
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [portfolioRes, marketRes] = await Promise.all([
        fetch('/api/holdings'),
        fetch('/api/markets/AU')
      ]);
      
      const holdings: PortfolioHolding[] = await portfolioRes.json();
      const totalValue = holdings.reduce((sum, h) => sum + (h.value_aud || 0), 0);
      
      const marketData: { quotes?: Array<{ symbol: string; price: number; change_percent?: number }> } = await marketRes.json();
      const priceMap = new Map((marketData.quotes || []).map((q) => [q.symbol, q]));
      
      // Enrich opportunities with live prices
      const enrichedOpps = ASX_OPPORTUNITIES.map(opp => {
        const marketPrice = priceMap.get(opp.symbol);
        return {
          ...opp,
          price: marketPrice?.price || 0,
          priceAud: marketPrice?.price || 0,
          change24h: marketPrice?.change_percent
        };
      });
      
      setOpportunities(enrichedOpps);
      setPortfolioWarnings(generateWarnings(holdings, totalValue));
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch advisor data:', error);
      setOpportunities(ASX_OPPORTUNITIES.map(opp => ({ ...opp, price: 0, priceAud: 0, change24h: undefined })));
    } finally {
      setIsLoading(false);
    }
  }, [generateWarnings]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredOpportunities = activeFilter === 'all' 
    ? opportunities 
    : opportunities.filter(o => o.category === activeFilter || o.recommendation === activeFilter);

  const highYieldOpps = opportunities.filter(o => o.yield > 4);
  const buyRecs = opportunities.filter(o => o.recommendation === 'buy');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold mb-1">Investment Advisor</h1>
            <p className="text-blue-100">Personalized recommendations based on your portfolio</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-blue-100">Last updated</p>
            <p className="font-medium">{lastUpdated.toLocaleTimeString()}</p>
            {isLoading && <Loader2 className="w-4 h-4 animate-spin ml-auto mt-1" />}
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-white/10 rounded-lg p-3">
            <p className="text-sm text-blue-100">Opportunities</p>
            <p className="text-2xl font-bold">{opportunities.length}</p>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <p className="text-sm text-blue-100">Buy Recommendations</p>
            <p className="text-2xl font-bold text-green-300">{buyRecs.length}</p>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <p className="text-sm text-blue-100">High Yield (&gt;4%)</p>
            <p className="text-2xl font-bold">{highYieldOpps.length}</p>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <p className="text-sm text-blue-100">Warnings</p>
            <p className="text-2xl font-bold text-amber-300">{portfolioWarnings.length}</p>
          </div>
        </div>
      </div>

      {/* Portfolio Health Alerts */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Portfolio Health Alerts
          </h2>
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {portfolioWarnings.map(warning => (
            <WarningCard key={warning.id} warning={warning} />
          ))}
          {portfolioWarnings.length === 0 && (
            <div className="col-span-2 p-8 text-center text-slate-500">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <p>No portfolio warnings. Your allocation looks healthy!</p>
            </div>
          )}
        </div>
      </div>

      {/* Investment Opportunities */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            Current Opportunities
            <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
              Live ASX Prices
            </span>
          </h2>
          
          <div className="flex flex-wrap gap-2">
            {['all', 'income', 'growth', 'defensive', 'buy'].map(filter => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeFilter === filter 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            <span className="ml-3 text-slate-600">Loading live prices...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredOpportunities.map(opp => (
              <OpportunityCard key={opp.id} opp={opp} />
            ))}
          </div>
        )}
      </div>

      {/* Strategy Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-purple-200 rounded-lg flex items-center justify-center">
              <Target className="w-5 h-5 text-purple-700" />
            </div>
            <h3 className="font-semibold text-purple-900">Income Focus</h3>
          </div>
          <p className="text-sm text-purple-800 mb-3">
            Target 4-5% yield from ASX dividend stocks with franking credits.
          </p>
          <ul className="text-sm text-purple-700 space-y-1">
            <li>• ANZ: 4.55% yield (70% franked)</li>
            <li>• RIO: 4.2% yield (100% franked)</li>
            <li>• TCL: 4.62% yield (infrastructure)</li>
          </ul>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 border border-blue-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-200 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-blue-700" />
            </div>
            <h3 className="font-semibold text-blue-900">Risk Management</h3>
          </div>
          <p className="text-sm text-blue-800 mb-3">
            Reduce concentration risk while maintaining growth exposure.
          </p>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Exit SUI position (high inflation)</li>
            <li>• Cap crypto at 10% of portfolio</li>
            <li>• Diversify real estate via REITs</li>
          </ul>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border border-green-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-green-200 rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-green-700" />
            </div>
            <h3 className="font-semibold text-green-900">Action Items</h3>
          </div>
          <p className="text-sm text-green-800 mb-3">
            Immediate steps to optimize your portfolio.
          </p>
          <ul className="text-sm text-green-700 space-y-1">
            <li>• Deploy $100K to VAS this month</li>
            <li>• Set up DCA: $20K/week to ANZ/RIO</li>
            <li>• Review SUI exit by month-end</li>
          </ul>
        </div>
      </div>

      {/* Priority Actions */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Priority Actions</h2>

        <div className="space-y-3">
          {portfolioWarnings.filter(w => w.severity === 'high').map((warning) => (
            <div key={warning.id} className="flex items-center justify-between p-4 bg-red-50 rounded-lg border border-red-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="font-medium text-slate-800">{warning.title}</p>
                  <p className="text-sm text-slate-500">{warning.suggestion}</p>
                </div>
              </div>
              <button className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
                Act
              </button>
            </div>
          ))}
          
          <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="font-medium text-slate-800">Deploy Cash to ASX Income</p>
                <p className="text-sm text-slate-500">ANZ + RIO + VAS allocation ($100K/month)</p>
              </div>
            </div>
            <button className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
              Plan
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg border border-blue-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="font-medium text-slate-800">Review Crypto Allocation</p>
                <p className="text-sm text-slate-500">Consolidate to BTC/ETH, reduce alt exposure</p>
              </div>
            </div>
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              Review
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Advisor;
