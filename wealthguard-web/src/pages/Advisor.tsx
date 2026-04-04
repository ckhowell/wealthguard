import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  TrendingUp, AlertTriangle, CheckCircle, Info,
  ArrowUpRight, Percent, Loader2,
  Building2, DollarSign,
  Target, Shield, Zap,
  Calendar, Calculator,
  ArrowRightLeft, Gift
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
  avg_buy_price?: number;
  dividend_yield?: number;
  franking_level?: number;
}

interface PortfolioWarning {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  message: string;
  suggestion: string;
  actionType?: 'rebalance' | 'diversify' | 'exit' | 'hold';
}

interface DividendStock {
  symbol: string;
  name: string;
  shares: number;
  currentPrice: number;
  yield: number;
  franking: number;
  value: number;
}

interface DividendStock {
  symbol: string;
  name: string;
  shares: number;
  currentPrice: number;
  yield: number;
  franking: number;
  value: number;
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

// Recommended dividend stocks for projections
const RECOMMENDED_DIVIDEND_STOCKS: DividendStock[] = [
  { symbol: 'ANZ.AX', name: 'ANZ Group', shares: 0, currentPrice: 28.50, yield: 4.55, franking: 70, value: 0 },
  { symbol: 'RIO.AX', name: 'Rio Tinto', shares: 0, currentPrice: 128.00, yield: 4.20, franking: 100, value: 0 },
  { symbol: 'VAS.AX', name: 'Vanguard ASX ETF', shares: 0, currentPrice: 98.00, yield: 3.80, franking: 70, value: 0 },
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

// ==================== NEW COMPONENTS ====================

// 1. Portfolio Rebalancing Calculator
const RebalancingCalculator = ({ 
  holdings, 
  totalValue 
}: { 
  holdings: PortfolioHolding[]; 
  totalValue: number;
}) => {
  const [targets, setTargets] = useState<Record<string, number>>({
    equity: 20,
    crypto: 10,
    cash: 15,
    realEstate: 50,
    alternative: 5,
  });

  // Calculate current allocation
  const currentAllocation = useMemo(() => {
    const allocation: Record<string, number> = {};
    holdings.forEach(h => {
      const assetClass = h.asset_class === 'current_account' ? 'cash' : h.asset_class;
      allocation[assetClass] = (allocation[assetClass] || 0) + h.value_aud;
    });
    return allocation;
  }, [holdings]);

  // Calculate rebalancing trades
  const rebalancingTrades = useMemo(() => {
    const trades: { assetClass: string; current: number; target: number; difference: number; action: 'buy' | 'sell' | 'hold' }[] = [];
    
    Object.entries(targets).forEach(([assetClass, targetPercent]) => {
      const currentValue = currentAllocation[assetClass] || 0;
      const currentPercent = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
      const targetValue = (targetPercent / 100) * totalValue;
      const difference = targetValue - currentValue;
      
      trades.push({
        assetClass,
        current: currentPercent,
        target: targetPercent,
        difference,
        action: difference > 1000 ? 'buy' : difference < -1000 ? 'sell' : 'hold'
      });
    });
    
    return trades.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
  }, [targets, currentAllocation, totalValue]);

  const assetClassLabels: Record<string, string> = {
    equity: 'Equities/Stocks',
    crypto: 'Cryptocurrency',
    cash: 'Cash',
    realEstate: 'Real Estate',
    alternative: 'Alternatives',
  };

  const assetClassColors: Record<string, string> = {
    equity: 'bg-red-500',
    crypto: 'bg-amber-500',
    cash: 'bg-green-500',
    realEstate: 'bg-blue-500',
    alternative: 'bg-purple-500',
  };

  const handleTargetChange = (assetClass: string, value: number) => {
    setTargets(prev => ({ ...prev, [assetClass]: value }));
  };

  const totalTarget = Object.values(targets).reduce((sum, v) => sum + v, 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-blue-600" />
          Portfolio Rebalancing Calculator
        </h2>
        <div className={`text-sm font-medium ${totalTarget === 100 ? 'text-green-600' : 'text-amber-600'}`}>
          Target Total: {totalTarget}%
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Target Allocation Inputs */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-slate-700">Set Target Allocation</h3>
          {Object.entries(targets).map(([assetClass, target]) => {
            const current = currentAllocation[assetClass] || 0;
            const currentPct = totalValue > 0 ? (current / totalValue) * 100 : 0;
            
            return (
              <div key={assetClass} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${assetClassColors[assetClass]}`} />
                    <span className="text-sm text-slate-700">{assetClassLabels[assetClass]}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Current: {currentPct.toFixed(1)}%</span>
                    <input
                      type="number"
                      value={target}
                      onChange={(e) => handleTargetChange(assetClass, Number(e.target.value))}
                      className="w-16 px-2 py-1 text-sm border border-slate-200 rounded-lg text-right"
                      min={0}
                      max={100}
                    />
                    <span className="text-sm text-slate-500">%</span>
                  </div>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${assetClassColors[assetClass]} transition-all`}
                    style={{ width: `${Math.min(target, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Rebalancing Suggestions */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-slate-700">Rebalancing Trades</h3>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {rebalancingTrades.map((trade) => (
              <div 
                key={trade.assetClass}
                className={`p-3 rounded-lg border ${
                  trade.action === 'buy' ? 'border-green-200 bg-green-50' :
                  trade.action === 'sell' ? 'border-red-200 bg-red-50' :
                  'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${assetClassColors[trade.assetClass]}`} />
                    <span className="font-medium text-slate-800">{assetClassLabels[trade.assetClass]}</span>
                  </div>
                  <span className={`text-sm font-bold ${
                    trade.action === 'buy' ? 'text-green-600' :
                    trade.action === 'sell' ? 'text-red-600' :
                    'text-slate-600'
                  }`}>
                    {trade.action === 'buy' ? 'BUY' : trade.action === 'sell' ? 'SELL' : 'HOLD'}
                  </span>
                </div>
                <div className="mt-2 text-sm text-slate-600">
                  <div className="flex justify-between">
                    <span>Current: {trade.current.toFixed(1)}%</span>
                    <span>Target: {trade.target}%</span>
                  </div>
                  {trade.action !== 'hold' && (
                    <div className="mt-1 font-medium">
                      {trade.action === 'buy' ? '+' : '-'}${Math.abs(trade.difference).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Specific Stock Suggestions */}
          <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
            <h4 className="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-2">
              <Calculator className="w-4 h-4" />
              Specific Trade Suggestions
            </h4>
            <ul className="space-y-2 text-sm text-blue-800">
              {rebalancingTrades.find(t => t.assetClass === 'equity' && t.action === 'buy') && (
                <li className="flex justify-between">
                  <span>Buy VAS.AX ETF</span>
                  <span className="font-medium">${Math.min(rebalancingTrades.find(t => t.assetClass === 'equity')?.difference || 0, 50000).toLocaleString()}</span>
                </li>
              )}
              {rebalancingTrades.find(t => t.assetClass === 'equity' && t.action === 'buy') && (
                <li className="flex justify-between">
                  <span>Buy ANZ.AX</span>
                  <span className="font-medium">${Math.min((rebalancingTrades.find(t => t.assetClass === 'equity')?.difference || 0) * 0.3, 30000).toLocaleString()}</span>
                </li>
              )}
              {rebalancingTrades.find(t => t.assetClass === 'equity' && t.action === 'buy') && (
                <li className="flex justify-between">
                  <span>Buy RIO.AX</span>
                  <span className="font-medium">${Math.min((rebalancingTrades.find(t => t.assetClass === 'equity')?.difference || 0) * 0.3, 30000).toLocaleString()}</span>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

// 2. Dividend Income Projector
const DividendProjector = ({ 
  holdings
}: { 
  holdings: PortfolioHolding[];
}) => {
  const [includeRecommendations, setIncludeRecommendations] = useState(true);
  const [additionalInvestment, setAdditionalInvestment] = useState(100000);

  // Current dividend-paying holdings
  const currentDividendHoldings = useMemo(() => {
    return holdings.filter(h => 
      h.asset_class === 'equity' || 
      (h.dividend_yield && h.dividend_yield > 0)
    ).map(h => ({
      symbol: h.symbol,
      name: h.asset_name,
      value: h.value_aud,
      yield: h.dividend_yield || 2.5, // Default estimate
      franking: h.franking_level || 50,
    }));
  }, [holdings]);

  // Calculate projected income
  const projections = useMemo(() => {
    let currentAnnual = 0;
    let currentFranking = 0;
    let projectedAnnual = 0;
    let projectedFranking = 0;

    // Current holdings
    currentDividendHoldings.forEach(h => {
      const income = h.value * (h.yield / 100);
      currentAnnual += income;
      currentFranking += income * (h.franking / 100);
    });

    // Add recommended stocks
    if (includeRecommendations) {
      RECOMMENDED_DIVIDEND_STOCKS.forEach(stock => {
        const investment = additionalInvestment * (stock.yield / 10); // Weight by yield
        const income = investment * (stock.yield / 100);
        projectedAnnual += income;
        projectedFranking += income * (stock.franking / 100);
      });
    }

    projectedAnnual += currentAnnual;
    projectedFranking += currentFranking;

    return {
      currentAnnual,
      currentMonthly: currentAnnual / 12,
      projectedAnnual,
      projectedMonthly: projectedAnnual / 12,
      currentFrankingCredit: currentFranking * 0.4286, // Franking credit formula
      projectedFrankingCredit: projectedFranking * 0.4286,
      currentYieldOnCost: currentDividendHoldings.reduce((sum, h) => sum + h.value, 0) > 0 
        ? (currentAnnual / currentDividendHoldings.reduce((sum, h) => sum + h.value, 0)) * 100 
        : 0,
    };
  }, [currentDividendHoldings, includeRecommendations, additionalInvestment]);

  const taxBenefit = projections.projectedFrankingCredit * 0.3; // Approximate tax benefit at 30%

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Gift className="w-5 h-5 text-purple-600" />
          Dividend Income Projector
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Income Summary */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
              <p className="text-xs text-purple-600 font-medium uppercase tracking-wide">Current Annual</p>
              <p className="text-2xl font-bold text-purple-900">${projections.currentAnnual.toLocaleString()}</p>
              <p className="text-xs text-purple-700">${Math.round(projections.currentMonthly).toLocaleString()}/month</p>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
              <p className="text-xs text-green-600 font-medium uppercase tracking-wide">Projected Annual</p>
              <p className="text-2xl font-bold text-green-900">${projections.projectedAnnual.toLocaleString()}</p>
              <p className="text-xs text-green-700">${Math.round(projections.projectedMonthly).toLocaleString()}/month</p>
            </div>
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
              <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">Franking Credits</p>
              <p className="text-2xl font-bold text-blue-900">${Math.round(projections.projectedFrankingCredit).toLocaleString()}</p>
              <p className="text-xs text-blue-700">Annual tax benefit</p>
            </div>
            <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-lg p-4 border border-amber-200">
              <p className="text-xs text-amber-600 font-medium uppercase tracking-wide">Yield on Cost</p>
              <p className="text-2xl font-bold text-amber-900">{projections.currentYieldOnCost.toFixed(2)}%</p>
              <p className="text-xs text-amber-700">Portfolio average</p>
            </div>
          </div>

          {/* Detailed Breakdown */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Dividend Breakdown by Stock</h3>
            <div className="max-h-48 overflow-y-auto space-y-2">
              {currentDividendHoldings.length > 0 ? (
                currentDividendHoldings.map(h => {
                  const annualIncome = h.value * (h.yield / 100);
                  const frankingCredit = annualIncome * (h.franking / 100) * 0.4286;
                  return (
                    <div key={h.symbol} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                          <span className="text-xs font-bold text-blue-700">{h.symbol.slice(0, 2)}</span>
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">{h.symbol}</p>
                          <p className="text-xs text-slate-500">{h.yield}% yield • {h.franking}% franked</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-slate-800">${Math.round(annualIncome).toLocaleString()}/yr</p>
                        <p className="text-xs text-green-600">+${Math.round(frankingCredit)} credit</p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-4 text-slate-500">
                  <p>No dividend-paying holdings found</p>
                  <p className="text-sm">Add ASX stocks to see projections</p>
                </div>
              )}
              
              {includeRecommendations && RECOMMENDED_DIVIDEND_STOCKS.map(stock => {
                const investment = additionalInvestment * (stock.yield / 10);
                const annualIncome = investment * (stock.yield / 100);
                const frankingCredit = annualIncome * (stock.franking / 100) * 0.4286;
                return (
                  <div key={stock.symbol} className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-100">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                        <span className="text-xs font-bold text-green-700">{stock.symbol.slice(0, 2)}</span>
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">{stock.symbol} <span className="text-xs text-green-600">(Recommended)</span></p>
                        <p className="text-xs text-slate-500">{stock.yield}% yield • {stock.franking}% franked</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-green-700">${Math.round(annualIncome).toLocaleString()}/yr</p>
                      <p className="text-xs text-green-600">+${Math.round(frankingCredit)} credit</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Settings Panel */}
        <div className="space-y-4">
          <div className="p-4 bg-slate-50 rounded-lg">
            <label className="flex items-center gap-2 mb-3">
              <input
                type="checkbox"
                checked={includeRecommendations}
                onChange={(e) => setIncludeRecommendations(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <span className="text-sm font-medium text-slate-700">Include Recommendations</span>
            </label>
            
            {includeRecommendations && (
              <div className="space-y-2">
                <label className="text-xs text-slate-600">Additional Investment</label>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">$</span>
                  <input
                    type="number"
                    value={additionalInvestment}
                    onChange={(e) => setAdditionalInvestment(Number(e.target.value))}
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg"
                    step={10000}
                    min={0}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Tax Benefit Card */}
          <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-100 rounded-lg border border-green-200">
            <h4 className="text-sm font-semibold text-green-900 mb-2">Franking Benefits</h4>
            <p className="text-xs text-green-700 mb-3">
              Franking credits reduce your tax liability. At 30% tax rate:
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-green-800">Franking Credits</span>
                <span className="font-bold text-green-900">${Math.round(projections.projectedFrankingCredit).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-green-800">Est. Tax Benefit</span>
                <span className="font-bold text-green-900">${Math.round(taxBenefit).toLocaleString()}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-green-200">
                <span className="text-green-900 font-medium">Effective Yield</span>
                <span className="font-bold text-green-900">
                  {((projections.projectedAnnual + projections.projectedFrankingCredit) / 
                    (currentDividendHoldings.reduce((sum, h) => sum + h.value, 0) + additionalInvestment) * 100).toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// 3. DCA Schedule
const DCASchedule = ({ 
  holdings
}: { 
  holdings: PortfolioHolding[];
}) => {
  const [monthlyAmount, setMonthlyAmount] = useState(20000);
  const [targets, setTargets] = useState({
    'VAS.AX': 40,
    'ANZ.AX': 30,
    'RIO.AX': 20,
    'TCL.AX': 10,
  });
  const [currentMonth, setCurrentMonth] = useState(0);

  // Calculate current allocations and gaps
  const allocationAnalysis = useMemo(() => {
    const analysis: Record<string, { 
      currentValue: number; 
      targetPercent: number; 
      gap: number;
      priority: number;
    }> = {};
    
    const totalTargetValue = monthlyAmount * 12; // Annual target
    
    Object.entries(targets).forEach(([symbol, targetPct]) => {
      const holding = holdings.find(h => h.symbol === symbol);
      const currentValue = holding?.value_aud || 0;
      const targetValue = (targetPct / 100) * totalTargetValue;
      const gap = Math.max(0, targetValue - currentValue);
      
      analysis[symbol] = {
        currentValue,
        targetPercent: targetPct,
        gap,
        priority: gap / (targetValue || 1),
      };
    });
    
    return analysis;
  }, [holdings, targets, monthlyAmount]);

  // Generate DCA schedule
  const dcaSchedule = useMemo(() => {
    const schedule: { month: number; symbol: string; amount: number; cumulative: number }[] = [];
    const remainingGap = { ...allocationAnalysis };
    let month = 1;
    let cumulative = 0;
    
    // Sort by priority (highest gap first)
    const sortedSymbols = Object.entries(remainingGap)
      .sort(([, a], [, b]) => b.priority - a.priority)
      .map(([symbol]) => symbol);
    
    while (month <= 24 && sortedSymbols.some(s => remainingGap[s].gap > 0)) {
      let monthlyBudget = monthlyAmount;
      
      for (const symbol of sortedSymbols) {
        if (monthlyBudget <= 0) break;
        if (remainingGap[symbol].gap <= 0) continue;
        
        // Allocate based on target weight
        const allocation = Math.min(
          monthlyBudget * (targets[symbol as keyof typeof targets] / 100),
          remainingGap[symbol].gap
        );
        
        if (allocation > 100) { // Minimum trade size
          schedule.push({
            month,
            symbol,
            amount: Math.round(allocation),
            cumulative: Math.round(cumulative + allocation),
          });
          remainingGap[symbol].gap -= allocation;
          monthlyBudget -= allocation;
          cumulative += allocation;
        }
      }
      
      // If there's remaining budget, allocate to highest priority
      if (monthlyBudget > 100) {
        const topPriority = sortedSymbols.find(s => remainingGap[s].gap > 0);
        if (topPriority) {
          schedule.push({
            month,
            symbol: topPriority,
            amount: Math.round(monthlyBudget),
            cumulative: Math.round(cumulative + monthlyBudget),
          });
          remainingGap[topPriority].gap -= monthlyBudget;
          cumulative += monthlyBudget;
        }
      }
      
      month++;
    }
    
    return schedule;
  }, [allocationAnalysis, monthlyAmount, targets]);

  // Calculate months to reach targets
  const monthsToTarget = useMemo(() => {
    const months: Record<string, number> = {};
    Object.keys(targets).forEach(symbol => {
      const trades = dcaSchedule.filter(s => s.symbol === symbol);
      months[symbol] = trades.length > 0 ? trades[trades.length - 1].month : 0;
    });
    return months;
  }, [dcaSchedule, targets]);

  const stockDetails: Record<string, { name: string; color: string }> = {
    'VAS.AX': { name: 'Vanguard ASX ETF', color: 'bg-blue-500' },
    'ANZ.AX': { name: 'ANZ Group', color: 'bg-green-500' },
    'RIO.AX': { name: 'Rio Tinto', color: 'bg-red-500' },
    'TCL.AX': { name: 'Transurban', color: 'bg-purple-500' },
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-green-600" />
          DCA Schedule
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Settings */}
        <div className="space-y-4">
          <div className="p-4 bg-slate-50 rounded-lg">
            <label className="text-sm font-medium text-slate-700 mb-2 block">
              Monthly Investment
            </label>
            <div className="flex items-center gap-2">
              <span className="text-slate-500">$</span>
              <input
                type="number"
                value={monthlyAmount}
                onChange={(e) => setMonthlyAmount(Number(e.target.value))}
                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg"
                step={1000}
                min={1000}
              />
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Annual: ${(monthlyAmount * 12).toLocaleString()}
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium text-slate-700">Target Allocation</h4>
            {Object.entries(targets).map(([symbol, percent]) => (
              <div key={symbol} className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${stockDetails[symbol]?.color || 'bg-slate-400'}`} />
                    <span className="text-sm text-slate-700">{symbol.replace('.AX', '')}</span>
                  </div>
                  <input
                    type="number"
                    value={percent}
                    onChange={(e) => setTargets(prev => ({ ...prev, [symbol]: Number(e.target.value) }))}
                    className="w-16 px-2 py-1 text-sm border border-slate-200 rounded-lg text-right"
                    min={0}
                    max={100}
                  />
                  <span className="text-xs text-slate-500">%</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${stockDetails[symbol]?.color || 'bg-slate-400'}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Progress Summary */}
          <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-100 rounded-lg border border-green-200">
            <h4 className="text-sm font-semibold text-green-900 mb-2">Progress to Targets</h4>
            <div className="space-y-2">
              {Object.entries(monthsToTarget).map(([symbol, months]) => (
                <div key={symbol} className="flex justify-between text-sm">
                  <span className="text-green-800">{symbol.replace('.AX', '')}</span>
                  <span className="font-medium text-green-900">
                    {months > 0 ? `${months} months` : 'Target met'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Schedule Timeline */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">24-Month Schedule</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentMonth(Math.max(0, currentMonth - 6))}
                className="px-3 py-1 text-xs bg-slate-100 rounded-lg hover:bg-slate-200"
                disabled={currentMonth === 0}
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentMonth(Math.min(18, currentMonth + 6))}
                className="px-3 py-1 text-xs bg-slate-100 rounded-lg hover:bg-slate-200"
                disabled={currentMonth >= 18}
              >
                Next
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              {/* Month headers */}
              <div className="grid grid-cols-7 gap-2 mb-2">
                {Array.from({ length: 6 }, (_, i) => currentMonth + i + 1).map(month => (
                  <div key={month} className="text-center text-xs font-medium text-slate-600 py-2 bg-slate-50 rounded">
                    Month {month}
                  </div>
                ))}
              </div>

              {/* Stock rows */}
              {Object.keys(targets).map(symbol => {
                const monthTrades = dcaSchedule.filter(s => 
                  s.symbol === symbol && 
                  s.month > currentMonth && 
                  s.month <= currentMonth + 6
                );
                
                return (
                  <div key={symbol} className="grid grid-cols-7 gap-2 mb-2">
                    <div className="col-span-7 text-xs font-medium text-slate-700 py-1 flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${stockDetails[symbol]?.color}`} />
                      {symbol.replace('.AX', '')} - {stockDetails[symbol]?.name}
                    </div>
                    {Array.from({ length: 6 }, (_, i) => currentMonth + i + 1).map(month => {
                      const trade = monthTrades.find(t => t.month === month);
                      return (
                        <div 
                          key={month}
                          className={`p-2 rounded text-center ${
                            trade 
                              ? `${stockDetails[symbol]?.color.replace('bg-', 'bg-opacity-20 bg-')} border border-opacity-30 ${stockDetails[symbol]?.color.replace('bg-', 'border-')}`
                              : 'bg-slate-50'
                          }`}
                        >
                          {trade ? (
                            <div>
                              <p className="text-xs font-bold text-slate-800">${(trade.amount / 1000).toFixed(0)}K</p>
                              <p className="text-[10px] text-slate-500">Buy</p>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">-</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 text-xs font-medium text-slate-500">Month</th>
                  <th className="text-left py-2 text-xs font-medium text-slate-500">Stock</th>
                  <th className="text-right py-2 text-xs font-medium text-slate-500">Amount</th>
                  <th className="text-right py-2 text-xs font-medium text-slate-500">Cumulative</th>
                </tr>
              </thead>
              <tbody>
                {dcaSchedule.slice(0, 10).map((trade, idx) => (
                  <tr key={idx} className="border-b border-slate-100">
                    <td className="py-2 text-slate-700">{trade.month}</td>
                    <td className="py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${stockDetails[trade.symbol]?.color.replace('bg-', 'bg-opacity-10 bg-')} text-slate-700`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${stockDetails[trade.symbol]?.color}`} />
                        {trade.symbol.replace('.AX', '')}
                      </span>
                    </td>
                    <td className="py-2 text-right font-medium text-slate-800">${trade.amount.toLocaleString()}</td>
                    <td className="py-2 text-right text-slate-600">${trade.cumulative.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dcaSchedule.length > 10 && (
              <p className="text-center text-xs text-slate-500 py-2">
                +{dcaSchedule.length - 10} more trades...
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

const Advisor = () => {
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [portfolioWarnings, setPortfolioWarnings] = useState<PortfolioWarning[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [totalValue, setTotalValue] = useState(0);

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
      
      const holdingsData: PortfolioHolding[] = await portfolioRes.json();
      const calculatedTotal = holdingsData.reduce((sum, h) => sum + (h.value_aud || 0), 0);
      
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
      
      setHoldings(holdingsData);
      setTotalValue(calculatedTotal);
      setOpportunities(enrichedOpps);
      setPortfolioWarnings(generateWarnings(holdingsData, calculatedTotal));
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

      {/* NEW: Portfolio Rebalancing Calculator */}
      <RebalancingCalculator holdings={holdings} totalValue={totalValue} />

      {/* NEW: Dividend Income Projector */}
      <DividendProjector holdings={holdings} />

      {/* NEW: DCA Schedule */}
      <DCASchedule holdings={holdings} />

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
