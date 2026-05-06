/**
 * A-Share (China Stock Market) Analysis Service
 * Fetches real-time data from Shanghai (SSE) and Shenzhen (SZSE) exchanges
 * Uses Sina Finance API (free, no auth required)
 */

export interface AShareQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  turnover: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  pe?: number;
  pb?: number;
  marketCap?: number;
}

export interface AShareIndex {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

// Major A-Share indices
export const AShareIndices = {
  'SH000001': '上证指数', // Shanghai Composite
  'SZ399001': '深证成指', // Shenzhen Component
  'SZ399006': '创业板指', // ChiNext Index
  'SH000300': '沪深300', // CSI 300
  'SH000016': '上证50', // SSE 50
};

// Format symbol for Sina API
function formatSymbol(symbol: string): string {
  // Remove any prefix
  const cleanSymbol = symbol.replace(/^(sh|sz|SS|SZ)/i, '');
  
  // Determine exchange based on symbol pattern
  // Shanghai: 600xxx, 601xxx, 603xxx, 688xxx (STAR Market)
  // Shenzhen: 000xxx, 002xxx (SME), 300xxx (ChiNext), 301xxx
  const shanghaiPattern = /^(6|9)/;
  const exchange = shanghaiPattern.test(cleanSymbol) ? 'sh' : 'sz';
  
  return `${exchange}${cleanSymbol}`;
}

// Parse Sina response
function parseSinaResponse(data: string): AShareQuote | null {
  try {
    // Sina returns: var hq_str_sh600000="浦发银行,10.50,10.40,10.55,10.60,10.45,10.54,10.55,1234567,13000000,...";
    const match = data.match(/var hq_str_\w+="([^"]*)";/);
    if (!match) return null;
    
    const parts = match[1].split(',');
    if (parts.length < 33) return null;
    
    const name = parts[0];
    const open = parseFloat(parts[1]);
    const prevClose = parseFloat(parts[2]);
    const price = parseFloat(parts[3]);
    const high = parseFloat(parts[4]);
    const low = parseFloat(parts[5]);
    const volume = parseInt(parts[8]) * 100; // Sina reports in lots (100 shares)
    const turnover = parseFloat(parts[9]) * 10000;
    
    const change = price - prevClose;
    const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
    
    return {
      symbol: '',
      name,
      price,
      change,
      changePercent,
      volume,
      turnover,
      open,
      high,
      low,
      prevClose,
    };
  } catch (error) {
    console.error('Parse error:', error);
    return null;
  }
}

// Fetch single stock quote
export async function fetchAShareQuote(symbol: string): Promise<AShareQuote | null> {
  try {
    const sinaSymbol = formatSymbol(symbol);
    const url = `https://hq.sinajs.cn/list=${sinaSymbol}`;
    
    // Note: Sina API requires Chinese referer in browser, use CORS proxy in production
    const response = await fetch(url, {
      headers: {
        'Referer': 'https://finance.sina.com.cn',
      },
    });
    
    if (!response.ok) throw new Error('Sina API error');
    
    const text = await response.text();
    const quote = parseSinaResponse(text);
    
    if (quote) {
      quote.symbol = symbol.toUpperCase();
    }
    
    return quote;
  } catch (error) {
    console.error(`Failed to fetch ${symbol}:`, error);
    return null;
  }
}

// Fetch multiple stocks
export async function fetchAShareQuotes(symbols: string[]): Promise<AShareQuote[]> {
  const quotes: AShareQuote[] = [];
  
  // Fetch in batches of 10 to avoid rate limits
  for (let i = 0; i < symbols.length; i += 10) {
    const batch = symbols.slice(i, i + 10);
    const promises = batch.map(s => fetchAShareQuote(s));
    const results = await Promise.all(promises);
    quotes.push(...results.filter((q): q is AShareQuote => q !== null));
  }
  
  return quotes;
}

// Fetch index data
export async function fetchAShareIndex(symbol: string): Promise<AShareIndex | null> {
  try {
    const sinaSymbol = symbol.startsWith('SH') ? 
      `sh${symbol.slice(2)}` : 
      `sz${symbol.slice(2)}`;
    
    const url = `https://hq.sinajs.cn/list=${sinaSymbol}`;
    const response = await fetch(url, {
      headers: {
        'Referer': 'https://finance.sina.com.cn',
      },
    });
    
    if (!response.ok) throw new Error('Sina API error');
    
    const text = await response.text();
    const quote = parseSinaResponse(text);
    
    if (quote) {
      return {
        symbol: symbol.toUpperCase(),
        name: AShareIndices[symbol as keyof typeof AShareIndices] || symbol,
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Failed to fetch index ${symbol}:`, error);
    return null;
  }
}

// Blue chip A-share stocks for analysis
export const AShareBlueChips = [
  { symbol: '600519', name: '贵州茅台', sector: 'Consumer', pe: 28 }, // Kweichow Moutai
  { symbol: '601318', name: '中国平安', sector: 'Insurance', pe: 8 }, // Ping An
  { symbol: '600036', name: '招商银行', sector: 'Banking', pe: 6 }, // China Merchants Bank
  { symbol: '000858', name: '五粮液', sector: 'Consumer', pe: 18 }, // Wuliangye
  { symbol: '002594', name: '比亚迪', sector: 'EV', pe: 25 }, // BYD
  { symbol: '300750', name: '宁德时代', sector: 'Battery', pe: 20 }, // CATL
  { symbol: '600276', name: '恒瑞医药', sector: 'Pharma', pe: 45 }, // Hengrui Medicine
  { symbol: '601888', name: '中国中免', sector: 'Retail', pe: 22 }, // China Tourism
  { symbol: '601012', name: '隆基绿能', sector: 'Solar', pe: 15 }, // LONGi
  { symbol: '300059', name: '东方财富', sector: 'Fintech', pe: 35 }, // East Money
];

// Short-term signal analysis
export interface SignalAnalysis {
  symbol: string;
  name: string;
  score: number;
  signal: 'BUY' | 'HOLD' | 'SELL' | 'NO_TRADE';
  reasons: string[];
  technicals: {
    rsi?: number;
    macd?: number;
    volumeRatio?: number;
    pricePosition?: string;
  };
}

// Simple technical analysis (mock - would use real indicators in production)
export function analyzeAShare(quote: AShareQuote): SignalAnalysis {
  const reasons: string[] = [];
  let score = 50;
  
  // Price momentum
  if (quote.changePercent > 2) {
    score += 10;
    reasons.push('强势上涨，突破近期区间');
  } else if (quote.changePercent < -2) {
    score -= 10;
    reasons.push('回调明显，短期承压');
  }
  
  // Volume analysis
  if (quote.volume > 1000000) {
    score += 5;
    reasons.push('成交量活跃，资金关注');
  }
  
  // Price position relative to day range
  const range = quote.high - quote.low;
  const position = range > 0 ? (quote.price - quote.low) / range : 0.5;
  
  if (position > 0.7) {
    score += 5;
    reasons.push('接近日内高点，买盘积极');
  } else if (position < 0.3) {
    score -= 5;
    reasons.push('日内偏弱，接近低点');
  }
  
  // Determine signal
  let signal: SignalAnalysis['signal'] = 'NO_TRADE';
  if (score >= 65) signal = 'BUY';
  else if (score >= 55) signal = 'HOLD';
  else if (score <= 40) signal = 'SELL';
  
  return {
    symbol: quote.symbol,
    name: quote.name,
    score,
    signal,
    reasons,
    technicals: {
      pricePosition: position > 0.7 ? 'high' : position < 0.3 ? 'low' : 'middle',
    },
  };
}

// Format market status
export function getMarketStatus(): string {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const day = now.getDay();
  
  // China market hours (UTC+8)
  // Pre-market: 09:15-09:25
  // Morning: 09:30-11:30
  // Afternoon: 13:00-15:00
  
  if (day === 0 || day === 6) {
    return 'Market Closed (Weekend)';
  }
  
  const time = hour * 60 + minute;
  
  if (time >= 570 && time < 585) {
    return 'Pre-market (Auction)';
  } else if (time >= 585 && time < 690) {
    return 'Morning Session';
  } else if (time >= 690 && time < 780) {
    return 'Lunch Break';
  } else if (time >= 780 && time < 900) {
    return 'Afternoon Session';
  } else {
    return 'Market Closed';
  }
}
