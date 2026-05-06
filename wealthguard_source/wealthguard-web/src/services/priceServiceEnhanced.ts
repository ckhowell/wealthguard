// Enhanced price fetching with multiple fallbacks
import type { PriceData } from './priceService';

// Yahoo Finance API (via CORS proxy)
const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

interface ParsedQuote {
  price: number;
  change24h?: number;
}

type CoinGeckoPayload = Record<string, { usd: number; usd_24h_change?: number }>;
interface CoinCapPayload {
  data?: { priceUsd: string; changePercent24Hr: string };
}

interface CryptoApi {
  name: string;
  url: (symbol: string) => string;
  parser: (data: unknown, symbol: string) => ParsedQuote | null;
}

// Alternative crypto APIs
const CRYPTO_APIS: CryptoApi[] = [
  {
    name: 'CoinGecko',
    url: (symbol: string) => `https://api.coingecko.com/api/v3/simple/price?ids=${getCoinGeckoId(symbol)}&vs_currencies=usd&include_24hr_change=true`,
    parser: (data: unknown, symbol: string) => {
      const payload = data as CoinGeckoPayload;
      const id = getCoinGeckoId(symbol);
      const hit = payload[id];
      if (hit) {
        return { price: hit.usd, change24h: hit.usd_24h_change };
      }
      return null;
    },
  },
  {
    name: 'CoinCap',
    url: (symbol: string) => `https://api.coincap.io/v2/assets/${symbol.toLowerCase()}`,
    parser: (data: unknown) => {
      const payload = data as CoinCapPayload;
      if (payload.data) {
        return {
          price: parseFloat(payload.data.priceUsd),
          change24h: parseFloat(payload.data.changePercent24Hr),
        };
      }
      return null;
    },
  },
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

import { getFxRate } from '../hooks/useFxRate';
import type { Currency } from '../types/api';

// Static fallback used only when the live FX cache and API are both unavailable.
// React components should prefer `useFxRate(from,to)`. Service code should
// prefer `convertCurrencyLive(...)` which uses the cached live rate.
const FX_FALLBACK: Record<string, number> = {
  'USD/AUD': 1.55,
  'AUD/USD': 0.645,
  'JPY/AUD': 0.009117,
  'AUD/JPY': 109.89,
};

function fallbackRate(from: string, to: string): number {
  if (from === to) return 1;
  if (FX_FALLBACK[`${from}/${to}`]) return FX_FALLBACK[`${from}/${to}`];
  if (FX_FALLBACK[`${to}/${from}`]) return 1 / FX_FALLBACK[`${to}/${from}`];
  return 1;
}

// Synchronous conversion against the static fallback. Use only when live FX is
// unavailable or the call site cannot await (e.g. some Recharts formatters).
export function convertCurrency(amount: number, from: string, to: string): number {
  return amount * fallbackRate(from, to);
}

// Live conversion via the cached `/api/fx-rates/latest` rate.
export async function convertCurrencyLive(amount: number, from: Currency, to: Currency): Promise<number> {
  const { rate } = await getFxRate(from, to);
  return amount * rate;
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Live AUD value from a USD price.
export async function cryptoToAud(usdPrice: number): Promise<number> {
  const { rate } = await getFxRate('USD', 'AUD');
  return usdPrice * rate;
}
