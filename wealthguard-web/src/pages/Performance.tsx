import { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp, Target, Percent, ArrowDownRight,
  BarChart3, Activity, Clock
} from 'lucide-react';
import { usePersistentState } from '../hooks/usePersistentState';

interface BenchmarkData {
  date: string;
  portfolio: number;
  rabobank: number;
  asx200: number;
  sp500: number;
  btc: number;
}

// Generate mock historical performance data
const generatePerformanceData = (): BenchmarkData[] => {
  const data: BenchmarkData[] = [];
  const startDate = new Date('2023-01-01');
  const endDate = new Date();

  let portfolioValue = 100;
  let rabobankValue = 100;
  let asx200Value = 100;
  let sp500Value = 100;
  let btcValue = 100;

  for (let d = new Date(startDate); d <= endDate; d.setMonth(d.getMonth() + 1)) {
    // Monthly returns (mock data)
    const portfolioReturn = (Math.random() - 0.45) * 0.08; // Slight positive bias
    const rabobankReturn = 0.0515 / 12; // 5.15% APY monthly
    const asx200Return = (Math.random() - 0.48) * 0.06;
    const sp500Return = (Math.random() - 0.47) * 0.06;
    const btcReturn = (Math.random() - 0.5) * 0.25; // High volatility

    portfolioValue *= (1 + portfolioReturn);
    rabobankValue *= (1 + rabobankReturn);
    asx200Value *= (1 + asx200Return);
    sp500Value *= (1 + sp500Return);
    btcValue *= (1 + btcReturn);

    data.push({
      date: d.toISOString().slice(0, 7),
      portfolio: Number(portfolioValue.toFixed(2)),
      rabobank: Number(rabobankValue.toFixed(2)),
      asx200: Number(asx200Value.toFixed(2)),
      sp500: Number(sp500Value.toFixed(2)),
      btc: Number(btcValue.toFixed(2)),
    });
  }

  return data;
};

interface PerformanceMetrics {
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  alpha: number;
  beta: number;
}

const calculateMetrics = (data: BenchmarkData[]): PerformanceMetrics => {
  if (data.length < 2) {
    return {
      totalReturn: 0,
      annualizedReturn: 0,
      volatility: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      alpha: 0,
      beta: 0,
    };
  }

  const start = data[0].portfolio;
  const end = data[data.length - 1].portfolio;
  const totalReturn = ((end - start) / start) * 100;

  const years = data.length / 12;
  const annualizedReturn = (Math.pow(end / start, 1 / years) - 1) * 100;

  // Calculate monthly returns for volatility
  const returns: number[] = [];
  let maxDrawdown = 0;
  let peak = start;

  for (let i = 1; i < data.length; i++) {
    const monthlyReturn = (data[i].portfolio - data[i - 1].portfolio) / data[i - 1].portfolio;
    returns.push(monthlyReturn);

    if (data[i].portfolio > peak) {
      peak = data[i].portfolio;
    }
    const drawdown = (peak - data[i].portfolio) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // Annualized volatility
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(12) * 100;

  // Sharpe ratio (assuming 5% risk-free rate)
  const riskFreeRate = 5;
  const sharpeRatio = volatility > 0 ? (annualizedReturn - riskFreeRate) / volatility : 0;

  return {
    totalReturn: Number(totalReturn.toFixed(2)),
    annualizedReturn: Number(annualizedReturn.toFixed(2)),
    volatility: Number(volatility.toFixed(2)),
    sharpeRatio: Number(sharpeRatio.toFixed(2)),
    maxDrawdown: Number((maxDrawdown * 100).toFixed(2)),
    alpha: Number((annualizedReturn - 7).toFixed(2)), // vs 7% benchmark
    beta: Number((0.8 + Math.random() * 0.4).toFixed(2)),
  };
};

const PerformancePage = () => {
  const [timeRange, setTimeRange] = usePersistentState<'1M' | '3M' | '6M' | '1Y' | 'ALL'>('performance-time-range', '1Y');
  const [showBenchmarks, setShowBenchmarks] = useState({
    rabobank: true,
    asx200: true,
    sp500: false,
    btc: false,
  });

  const performanceData = useMemo(() => generatePerformanceData(), []);

  const filteredData = useMemo(() => {
    const now = new Date();
    const months = {
      '1M': 1,
      '3M': 3,
      '6M': 6,
      '1Y': 12,
      'ALL': performanceData.length,
    };

    const cutoff = new Date();
    cutoff.setMonth(now.getMonth() - months[timeRange]);

    return performanceData.filter(d => new Date(d.date + '-01') >= cutoff);
  }, [performanceData, timeRange]);

  const metrics = useMemo(() => calculateMetrics(filteredData), [filteredData]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-6 h-6" />
              <h1 className="text-2xl font-bold">Performance Analytics</h1>
            </div>
            <p className="text-indigo-100">Track returns vs benchmarks • Risk metrics • Alpha/Beta analysis</p>
          </div>

          <div className="flex gap-2">
            {(['1M', '3M', '6M', '1Y', 'ALL'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  timeRange === range
                    ? 'bg-white text-indigo-600'
                    : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white/10 rounded-lg px-4 py-3">
            <p className="text-sm text-indigo-100">Total Return</p>
            <p className={`text-2xl font-bold ${metrics.totalReturn >= 0 ? 'text-green-300' : 'text-red-300'}`}>
              {metrics.totalReturn >= 0 ? '+' : ''}{metrics.totalReturn}%
            </p>
          </div>
          <div className="bg-white/10 rounded-lg px-4 py-3">
            <p className="text-sm text-indigo-100">Annualized</p>
            <p className={`text-2xl font-bold ${metrics.annualizedReturn >= 0 ? 'text-green-300' : 'text-red-300'}`}>
              {metrics.annualizedReturn >= 0 ? '+' : ''}{metrics.annualizedReturn}%
            </p>
          </div>
          <div className="bg-white/10 rounded-lg px-4 py-3">
            <p className="text-sm text-indigo-100">Sharpe Ratio</p>
            <p className="text-2xl font-bold">{metrics.sharpeRatio}</p>
          </div>
          <div className="bg-white/10 rounded-lg px-4 py-3">
            <p className="text-sm text-indigo-100">Max Drawdown</p>
            <p className="text-2xl font-bold text-red-300">-{metrics.maxDrawdown}%</p>
          </div>
        </div>
      </div>

      {/* Benchmark Comparison Chart */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-800">Benchmark Comparison</h2>

          <div className="flex flex-wrap gap-3">
            {Object.entries(showBenchmarks).map(([key, enabled]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setShowBenchmarks(prev => ({ ...prev, [key]: e.target.checked }))}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-600 capitalize">{key}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={filteredData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#64748b" />
              <YAxis tick={{ fontSize: 12 }} stroke="#64748b" />
              <Tooltip
                contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                formatter={(value) => Number(value).toFixed(2)}
              />
              <Legend />
              <Line type="monotone" dataKey="portfolio" name="Portfolio" stroke="#4f46e5" strokeWidth={3} dot={false} />
              {showBenchmarks.rabobank && (
                <Line type="monotone" dataKey="rabobank" name="Rabobank 5.15%" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="5 5" />
              )}
              {showBenchmarks.asx200 && (
                <Line type="monotone" dataKey="asx200" name="ASX 200" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="5 5" />
              )}
              {showBenchmarks.sp500 && (
                <Line type="monotone" dataKey="sp500" name="S&P 500" stroke="#3b82f6" strokeWidth={2} dot={false} strokeDasharray="5 5" />
              )}
              {showBenchmarks.btc && (
                <Line type="monotone" dataKey="btc" name="Bitcoin" stroke="#8b5cf6" strokeWidth={2} dot={false} strokeDasharray="5 5" />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Risk Metrics */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Risk Metrics</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-3">
                <Percent className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">Volatility (Annual)</span>
              </div>
              <span className="font-semibold text-slate-800">{metrics.volatility}%</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">Sharpe Ratio</span>
              </div>
              <span className={`font-semibold ${metrics.sharpeRatio > 1 ? 'text-green-600' : 'text-amber-600'}`}>
                {metrics.sharpeRatio}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-3">
                <ArrowDownRight className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">Maximum Drawdown</span>
              </div>
              <span className="font-semibold text-red-600">-{metrics.maxDrawdown}%</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-3">
                <Target className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">Beta (vs ASX200)</span>
              </div>
              <span className="font-semibold text-slate-800">{metrics.beta}</span>
            </div>
          </div>
        </div>

        {/* Alpha Analysis */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-slate-500" />
            <h2 className="text-lg font-semibold text-slate-800">Alpha Analysis</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-3">
                <Target className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">Alpha (excess return)</span>
              </div>
              <span className={`font-semibold ${metrics.alpha > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {metrics.alpha > 0 ? '+' : ''}{metrics.alpha}%
              </span>
            </div>

            <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100">
              <p className="text-sm text-indigo-800 mb-2">
                <strong>Alpha:</strong> Your portfolio's excess return compared to a benchmark.
              </p>
              <p className="text-xs text-indigo-600">
                {metrics.alpha > 0
                  ? `You're outperforming by ${metrics.alpha}% annually. Great job!`
                  : `You're underperforming by ${Math.abs(metrics.alpha)}%. Consider rebalancing.`}
              </p>
            </div>

            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-sm font-medium text-slate-700 mb-2">Benchmark Comparison</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">vs Rabobank (5.15%)</span>
                  <span className={`font-medium ${metrics.annualizedReturn > 5.15 ? 'text-green-600' : 'text-red-600'}`}>
                    {metrics.annualizedReturn > 5.15 ? '+' : ''}{(metrics.annualizedReturn - 5.15).toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">vs Typical ASX200 (7%)</span>
                  <span className={`font-medium ${metrics.annualizedReturn > 7 ? 'text-green-600' : 'text-red-600'}`}>
                    {metrics.annualizedReturn > 7 ? '+' : ''}{(metrics.annualizedReturn - 7).toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PerformancePage;
