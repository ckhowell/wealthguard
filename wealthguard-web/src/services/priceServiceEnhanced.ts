// Enhanced price fetching with multiple fallbacks
import type { PriceData } from './priceService';

// Yahoo Finance API (via CORS proxy)
const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Alternative crypto APIs
const CRYPTO_APIS = [
  {
    name: 'CoinGecko',
    url: (symbol: string) => `https://api.coingecko.com/api/v3/simple/price?ids=${getCoinGeckoId(symbol)}&vs_currencies=usd&include_24hr_change=true`,
    parser: (data: any, symbol: string) => {
      const id = getCoinGeckoId(symbol);
      if (data[id]) {
        return {
          price: data[id].usd,
          change24h: data[id].usd_24h_change,
        };
      }
      return null;
    }
  },
  {
    name: 'CoinCap',
    url: (symbol: string) => `https://api.coincap.io/v2/assets/${symbol.toLowerCase()}`,
    parser: (data: any) => {
      if (data.data) {
        return {
          price: parseFloat(data.data.priceUsd),
          change24h: parseFloat(data.data.changePercent24Hr),
        };
      }
      return null;
    }
  }
];

// CoinGecko ID mapping
const COINGECKO_IDS: Record<string, string> = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'SOL': 'solana',
  'XRP': 'ripple',
  'SUI': 'sui',
};

function getCoinGeckoId(symbol: string): string {
  return COINGECKO_IDS[symbol.toUpperCase()] || symbol.toLowerCase();
}

// Fetch with timeout
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 5000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// Fetch stock price from Yahoo Finance
export async function fetchStockPrice(symbol: string): Promise<PriceData | null> {
  try {
    const response = await fetchWithTimeout(
      `${YAHOO_BASE}/${symbol.toUpperCase()}?interval=1d&range=1d`,
      {},
      10000
    );
    
    if (!response.ok) throw new Error('Yahoo API error');
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) throw new Error('No data');
    
    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const prevClose = meta.previousClose || meta.chartPreviousClose;
    const change24h = prevClose ? ((price - prevClose) / prevClose) * 100 : undefined;
    
    return {
      symbol: symbol.toUpperCase(),
      price,
      currency: meta.currency || 'USD',
      change24h,
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`Failed to fetch ${symbol} from Yahoo:`, error);
    return null;
  }
}

// Fetch crypto price with fallback
export async function fetchCryptoPrice(symbol: string): Promise<PriceData | null> {
  for (const api of CRYPTO_APIS) {
    try {
      const response = await fetchWithTimeout(api.url(symbol), {}, 5000);
      
      if (!response.ok) continue;
      
      const data = await response.json();
      const parsed = api.parser(data, symbol);
      
      if (parsed) {
        return {
          symbol: symbol.toUpperCase(),
          price: parsed.price,
          currency: 'USD',
          change24h: parsed.change24h,
          lastUpdated: new Date().toISOString(),
        };
      }
    } catch (error) {
      console.warn(`${api.name} failed for ${symbol}:`, error);
      continue;
    }
  }
  
  return null;
}

// Batch fetch all prices
export async function fetchAllLivePrices(
  stockSymbols: string[] = [],
  cryptoSymbols: string[] = []
): Promise<Record<string, PriceData>> {
  const prices: Record<string, PriceData> = {};
  
  // Fetch stocks in parallel
  const stockPromises = stockSymbols.map(async (symbol) => {
    const data = await fetchStockPrice(symbol);
    if (data) prices[symbol.toUpperCase()] = data;
  });
  
  // Fetch crypto in parallel
  const cryptoPromises = cryptoSymbols.map(async (symbol) => {
    const data = await fetchCryptoPrice(symbol);
    if (data) prices[symbol.toUpperCase()] = data;
  });
  
  await Promise.all([...stockPromises, ...cryptoPromises]);
  
  return prices;
}

// Currency conversion rates (in production, fetch from an API)
export const FX_RATES: Record<string, number> = {
  'USD/AUD': 1.447,
  'AUD/USD': 0.691,
  'JPY/AUD': 0.0091,
  'AUD/JPY': 109.89,
};

export function convertCurrency(amount: number, from: string, to: string): number {
  const pair = `${from}/${to}`;
  const rate = FX_RATES[pair];
  if (rate) return amount * rate;
  
  // Try inverse
  const inverse = `${to}/${from}`;
  const inverseRate = FX_RATES[inverse];
  if (inverseRate) return amount / inverseRate;
  
  return amount;
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Get AUD value from USD crypto price
export function cryptoToAud(usdPrice: number): number {
  return usdPrice * FX_RATES['USD/AUD'];
}
