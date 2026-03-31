import { useMemo } from 'react';
import { 
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Legend
} from 'recharts';
import { 
  Shield, AlertTriangle, CheckCircle, Info,
  TrendingDown, Activity, Target
} from 'lucide-react';
import { usePersistentState } from '../hooks/usePersistentState';

// Risk assessment types
interface RiskFactor {
  name: string;
  score: number; // 0-100
  level: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  recommendation?: string;
}

// Portfolio risk analysis based on current allocation
const analyzePortfolioRisk = (holdings: any[]): RiskFactor[] => {
  const totalValue = holdings.reduce((sum, h) => sum + (h.value || 0), 0);
  
  // Calculate allocations
  const realEstate = holdings.filter(h => h.type === 'realEstate').reduce((sum, h) => sum + h.value, 0);
  const crypto = holdings.filter(h => h.type === 'crypto').reduce((sum, h) => sum + h.value, 0);
  const cash = holdings.filter(h => h.type === 'cash').reduce((sum, h) => sum + h.value, 0);
  const stocks = holdings.filter(h => h.type === 'stock').reduce((sum, h) => sum + h.value, 0);
  
  const realEstatePct = (realEstate / totalValue) * 100;
  const cryptoPct = (crypto / totalValue) * 100;
  const cashPct = (cash / totalValue) * 100;
  const stocksPct = (stocks / totalValue) * 100;
  
  const risks: RiskFactor[] = [];
  
  // Real estate concentration
  if (realEstatePct > 60) {
    risks.push({
      name: 'Real Estate Concentration',
      score: 85,
      level: 'critical',
      description: `${realEstatePct.toFixed(1)}% of net worth in real estate`,
      recommendation: 'Consider diversifying into liquid assets. Target: <50% real estate',
    });
  } else if (realEstatePct > 50) {
    risks.push({
      name: 'Real Estate Concentration',
      score: 70,
      level: 'high',
      description: `${realEstatePct.toFixed(1)}% of net worth in real estate`,
      recommendation: 'Monitor liquidity needs. Target: <50% real estate',
    });
  }
  
  // Crypto volatility
  if (cryptoPct > 20) {
    risks.push({
      name: 'Crypto Volatility',
      score: 75,
      level: 'high',
      description: `${cryptoPct.toFixed(1)}% in crypto assets`,
      recommendation: 'Consider reducing to <15% for capital preservation goals',
    });
  } else if (cryptoPct > 15) {
    risks.push({
      name: 'Crypto Volatility',
      score: 55,
      level: 'medium',
      description: `${cryptoPct.toFixed(1)}% in crypto assets`,
      recommendation: 'Monitor correlation with other assets',
    });
  }
  
  // Cash drag
  if (cashPct > 20) {
    risks.push({
      name: 'Cash Drag (Inflation)',
      score: 60,
      level: 'medium',
      description: `${cashPct.toFixed(1)}% in cash - inflation risk`,
      recommendation: 'Deploy excess cash into income-generating assets',
    });
  } else if (cashPct < 5) {
    risks.push({
      name: 'Low Liquidity',
      score: 50,
      level: 'medium',
      description: `Only ${cashPct.toFixed(1)}% in cash reserves`,
      recommendation: 'Maintain 6-12 months expenses in liquid cash',
    });
  }
  
  // Stock underweight
  if (stocksPct < 10) {
    risks.push({
      name: 'Stock Underweight',
      score: 45,
      level: 'low',
      description: `Only ${stocksPct.toFixed(1)}% in equities`,
      recommendation: 'Consider building equity position for growth',
    });
  }
  
  // Geographic concentration (based on holdings data)
  const hasJapanProperty = holdings.some(h => 
    h.type === 'realEstate' && (h.location?.toLowerCase().includes('niseko') || h.location?.toLowerCase().includes('japan'))
  );
  const hasAustraliaProperty = holdings.some(h => 
    h.type === 'realEstate' && (h.location?.toLowerCase().includes('australia') || h.location?.toLowerCase().includes('queensland') || h.location?.toLowerCase().includes('tasmania'))
  );
  
  if (hasJapanProperty && hasAustraliaProperty) {
    risks.push({
      name: 'Geographic Diversification',
      score: 40,
      level: 'low',
      description: 'Properties in multiple countries',
      recommendation: 'Good geographic spread - monitor FX exposure',
    });
  }
  
  return risks.sort((a, b) => b.score - a.score);
};

// Calculate overall risk score
const calculateOverallRisk = (risks: RiskFactor[]): { score: number; level: string } => {
  if (risks.length === 0) return { score: 20, level: 'low' };
  
  const avgScore = risks.reduce((sum, r) => sum + r.score, 0) / risks.length;
  const maxScore = Math.max(...risks.map(r => r.score));
  
  // Weight towards worst risk factor
  const weightedScore = (avgScore * 0.4) + (maxScore * 0.6);
  
  let level = 'low';
  if (weightedScore >= 75) level = 'critical';
  else if (weightedScore >= 60) level = 'high';
  else if (weightedScore >= 40) level = 'medium';
  
  return { score: Math.round(weightedScore), level };
};

interface RiskRadarData {
  subject: string;
  current: number;
  target: number;
  fullMark: number;
}

const generateRadarData = (risks: RiskFactor[]): RiskRadarData[] => {
  const defaultFactors = [
    { subject: 'Concentration', current: 0, target: 50, fullMark: 100 },
    { subject: 'Liquidity', current: 0, target: 70, fullMark: 100 },
    { subject: 'Volatility', current: 0, target: 60, fullMark: 100 },
    { subject: 'Inflation', current: 0, target: 50, fullMark: 100 },
    { subject: 'Geography', current: 0, target: 70, fullMark: 100 },
    { subject: 'Correlation', current: 0, target: 60, fullMark: 100 },
  ];
  
  // Map risk scores to radar data
  const concentrationRisk = risks.find(r => r.name.includes('Concentration'));
  const liquidityRisk = risks.find(r => r.name.includes('Liquidity'));
  const volatilityRisk = risks.find(r => r.name.includes('Volatility'));
  const inflationRisk = risks.find(r => r.name.includes('Inflation'));
  const geoRisk = risks.find(r => r.name.includes('Geographic'));
  
  if (concentrationRisk) defaultFactors[0].current = concentrationRisk.score;
  if (liquidityRisk) defaultFactors[1].current = liquidityRisk.score;
  if (volatilityRisk) defaultFactors[2].current = volatilityRisk.score;
  if (inflationRisk) defaultFactors[3].current = inflationRisk.score;
  if (geoRisk) defaultFactors[4].current = 100 - geoRisk.score; // Inverse for diversification
  
  return defaultFactors;
};

const RiskAnalysis = () => {
  // Get holdings from localStorage (same as Portfolio)
  const [holdings] = usePersistentState<any[]>('wealthguard-holdings', []);
  
  const risks = useMemo(() => analyzePortfolioRisk(holdings), [holdings]);
  const overallRisk = useMemo(() => calculateOverallRisk(risks), [risks]);
  const radarData = useMemo(() => generateRadarData(risks), [risks]);
  
  const getRiskColor = (level: string) => {
    switch (level) {
      case 'critical': return 'text-red-600 bg-red-50 border-red-200';
      case 'high': return 'text-orange-600 bg-orange-50 border-orange-200';
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'low': return 'text-green-600 bg-green-50 border-green-200';
      default: return 'text-slate-600 bg-slate-50 border-slate-200';
    }
  };
  
  const getRiskIcon = (level: string) => {
    switch (level) {
      case 'critical': return <AlertTriangle className="w-5 h-5" />;
      case 'high': return <TrendingDown className="w-5 h-5" />;
      case 'medium': return <Info className="w-5 h-5" />;
      case 'low': return <CheckCircle className="w-5 h-5" />;
      default: return <Info className="w-5 h-5" />;
    }
  };
  
  return (
    <div className="space-y-6">
      {/* Overall Risk Score */}
      <div className={`rounded-xl p-6 border-2 ${getRiskColor(overallRisk.level)}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-sm">
              <span className="text-2xl font-bold">{overallRisk.score}</span>
            </div>
            <div>
              <h2 className="text-xl font-bold capitalize">{overallRisk.level} Risk Profile</h2>
              <p className="text-sm opacity-80">
                {overallRisk.score < 40 ? 'Well diversified portfolio' :
                 overallRisk.score < 60 ? 'Some areas need attention' :
                 overallRisk.score < 75 ? 'Significant risks detected' :
                 'Critical issues require immediate action'}
              </p>
            </div>
          </div>
          
          <Shield className="w-8 h-8 opacity-50" />
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Risk Radar Chart */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Risk Profile Radar</h2>
          </div>
          
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} />
                <Radar
                  name="Current"
                  dataKey="current"
                  stroke="#ef4444"
                  fill="#ef4444"
                  fillOpacity={0.3}
                />
                <Radar
                  name="Target"
                  dataKey="target"
                  stroke="#10b981"
                  fill="#10b981"
                  fillOpacity={0.1}
                  strokeDasharray="4 4"
                />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          
          <p className="text-xs text-slate-500 text-center mt-2">
            Lower scores (red) are better for risk factors
          </p>
        </div>
        
        {/* Risk Factors List */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-5 h-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Risk Factors ({risks.length})</h2>
          </div>
          
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {risks.length === 0 ? (
              <div className="p-4 bg-green-50 rounded-lg text-center">
                <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
                <p className="text-green-800 font-medium">No significant risks detected</p>
                <p className="text-sm text-green-600">Your portfolio appears well-balanced</p>
              </div>
            ) : (
              risks.map((risk, index) => (
                <div 
                  key={index}
                  className={`p-4 rounded-lg border ${getRiskColor(risk.level)}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{getRiskIcon(risk.level)}</div>
                    
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-medium">{risk.name}</h3>
                        <span className="text-sm font-bold">{risk.score}/100</span>
                      </div>
                      
                      <p className="text-sm opacity-80 mb-2">{risk.description}</p>
                      
                      <div className="w-full bg-white/50 rounded-full h-1.5 mb-2">
                        <div 
                          className="h-1.5 rounded-full bg-current transition-all"
                          style={{ width: `${risk.score}%` }}
                        />
                      </div>
                      
                      {risk.recommendation && (
                        <p className="text-xs opacity-70">
                          💡 {risk.recommendation}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      {/* Risk Recommendations */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Recommended Actions</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
            <h3 className="font-medium text-blue-800 mb-2">1. Diversify Real Estate</h3>
            <p className="text-sm text-blue-700">
              Consider reducing real estate exposure from 65% to 50% over 12-18 months 
              by deploying cash into dividend stocks.
            </p>
          </div>
          
          <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
            <h3 className="font-medium text-purple-800 mb-2">2. Crypto Rebalancing</h3>
            <p className="text-sm text-purple-700">
              Evaluate SUI/XRP positions. Consider taking profits on BTC/ETH 
              and reducing total crypto to &lt;15% of portfolio.
            </p>
          </div>
          
          <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
            <h3 className="font-medium text-emerald-800 mb-2">3. Build Equity Position</h3>
            <p className="text-sm text-emerald-700">
              Start DCA into ASX blue chips (ANZ, RIO, TCL, VAS) with 
              $10-15k monthly deployments from cash reserves.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RiskAnalysis;
