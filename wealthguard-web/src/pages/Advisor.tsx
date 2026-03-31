import { useState } from 'react';
import { 
  TrendingUp, AlertTriangle, CheckCircle, Info,
  ArrowUpRight, Percent,
  Building2, LineChart
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
  thesis: string;
  risks: string[];
  recommendation: 'buy' | 'hold' | 'avoid' | 'watch';
  category: 'income' | 'growth' | 'defensive' | 'speculative';
  tags: string[];
}

const opportunities: Opportunity[] = [
  {
    id: '1',
    symbol: 'ANZ',
    name: 'ANZ Group Holdings',
    type: 'stock',
    exchange: 'ASX',
    yield: 4.55,
    franking: 70,
    price: 28.50,
    thesis: 'Quiet winner in 2025, up 40% since April. Trading at discount to NAB/Westpac despite strong capital position. New CEO making smart divestments.',
    risks: ['Exposure to commercial real estate', 'Competition from neobanks', 'Interest rate sensitivity'],
    recommendation: 'buy',
    category: 'income',
    tags: ['dividend', 'banking', 'blue-chip', 'franked']
  },
  {
    id: '2',
    symbol: 'RIO',
    name: 'Rio Tinto',
    type: 'stock',
    exchange: 'ASX',
    yield: 4.2,
    franking: 100,
    price: 125.80,
    thesis: 'Commodity exposure without crypto volatility. Iron ore cash machine, lithium pivot for EV transition. 100% franking makes yield tax-efficient.',
    risks: ['China demand dependency', 'Commodity price cycles', 'ESG pressures'],
    recommendation: 'buy',
    category: 'income',
    tags: ['mining', 'commodities', 'fully-franked', 'dividend']
  },
  {
    id: '3',
    symbol: 'TCL',
    name: 'Transurban Group',
    type: 'stock',
    exchange: 'ASX',
    yield: 4.62,
    franking: 0,
    price: 13.20,
    thesis: 'Toll roads = inflation-linked recurring revenue. Monopoly assets in Melbourne, Sydney, Brisbane. Steady cashflows regardless of economic cycles.',
    risks: ['Interest rate sensitivity (high debt)', 'Traffic volume risk', 'Regulatory changes'],
    recommendation: 'buy',
    category: 'defensive',
    tags: ['infrastructure', 'toll-roads', 'recurring-revenue']
  },
  {
    id: '4',
    symbol: 'WES',
    name: 'Wesfarmers',
    type: 'stock',
    exchange: 'ASX',
    yield: 3.1,
    franking: 100,
    price: 68.40,
    thesis: 'Bunnings + Kmart + Officeworks = exposure to resilient consumer spending. Strong management, consistent dividend growth.',
    risks: ['Consumer spending slowdown', 'Amazon competition', 'Retail cyclicality'],
    recommendation: 'watch',
    category: 'growth',
    tags: ['retail', 'consumer', 'fully-franked']
  },
  {
    id: '5',
    symbol: 'VAS',
    name: 'Vanguard Australian Shares ETF',
    type: 'etf',
    exchange: 'ASX',
    yield: 3.8,
    franking: 70,
    price: 95.20,
    thesis: 'Instant diversification across ASX 300. Low fees (0.10%), passive management. Good for deploying cash without picking individual stocks.',
    risks: ['Market beta exposure', 'Concentration in banks/materials', 'No downside protection'],
    recommendation: 'buy',
    category: 'growth',
    tags: ['etf', 'diversified', 'passive', 'franked']
  }
];

const portfolioWarnings = [
  {
    id: 'concentration',
    severity: 'high',
    title: 'Real Estate Concentration',
    message: '65% of net worth in real estate creates liquidity risk. Consider diversification into income-producing assets.',
    suggestion: 'Deploy $200-300K from cash into ASX dividend stocks'
  },
  {
    id: 'sui-risk',
    severity: 'high',
    title: 'SUI Tokenomics Risk',
    message: '55% annual inflation, 82% drawdown from ATH. Position is small ($4.7K) but shows 8.5% daily volatility.',
    suggestion: 'Consider exiting position and reallocating to BTC/ETH or ASX income stocks'
  },
  {
    id: 'cash-drag',
    severity: 'medium',
    title: 'Cash Drag',
    message: '$580K earning 5.15% vs potential 6-8% total return from dividend + growth portfolio.',
    suggestion: 'Gradual deployment: $100K/month into VAS + ANZ + RIO over 5-6 months'
  },
  {
    id: 'fx-exposure',
    severity: 'low',
    title: 'JPY Property FX Risk',
    message: '$501K AUD equivalent in Japan property. JPY/AUD at historic lows (0.0091).',
    suggestion: 'Consider hedging or viewing as diversification play'
  }
];

const OpportunityCard = ({ opp }: { opp: Opportunity }) => {
  const [expanded, setExpanded] = useState(false);
  
  const getRecColor = (rec: string) => {
    switch (rec) {
      case 'buy': return 'bg-green-100 text-green-800';
      case 'hold': return 'bg-blue-100 text-blue-800';
      case 'avoid': return 'bg-red-100 text-red-800';
      default: return 'bg-yellow-100 text-yellow-800';
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

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-bold text-slate-800">{opp.symbol}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getRecColor(opp.recommendation)}`}>
                {opp.recommendation.toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-slate-500">{opp.name}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-slate-800">${opp.price.toFixed(2)}</p>
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
          {opp.franking !== undefined && (
            <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700">
              {opp.franking}% franked
            </span>
          )}
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

const WarningCard = ({ warning }: { warning: typeof portfolioWarnings[0] }) => {
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
  const [lastUpdated] = useState(new Date());

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

      {/* Portfolio Warnings */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          Portfolio Health Alerts
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {portfolioWarnings.map(warning => (
            <WarningCard key={warning.id} warning={warning} />
          ))}
        </div>
      </div>

      {/* Investment Opportunities */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            Current Opportunities
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredOpportunities.map(opp => (
            <OpportunityCard key={opp.id} opp={opp} />
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Suggested Actions</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="font-medium text-slate-800">Exit SUI Position</p>
                <p className="text-sm text-slate-500">~$4,713 AUD | Reduce speculation exposure</p>
              </div>
            </div>
            <button className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
              Review
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="font-medium text-slate-800">Deploy $100K to ASX Income</p>
                <p className="text-sm text-slate-500">ANZ + RIO + VAS allocation</p>
              </div>
            </div>
            <button className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
              Plan
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <LineChart className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="font-medium text-slate-800">Rebalance Crypto</p>
                <p className="text-sm text-slate-500">Consolidate to BTC/ETH, exit alt speculation</p>
              </div>
            </div>
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              Analyze
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Advisor;
