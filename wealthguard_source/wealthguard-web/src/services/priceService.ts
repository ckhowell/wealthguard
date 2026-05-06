// Price fetching service for stocks and crypto
// Uses CoinGecko for crypto (free tier) and Yahoo Finance for stocks

export interface PriceData {
  symbol: string;
  price: number;
  currency: string;
  change24h?: number;
  lastUpdated: string;
}

export interface PriceCache {
  prices: Record<string, PriceData>;
  lastUpdated: string;
}

const CACHE_KEY = 'wealthguard-price-cache';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// CoinGecko ID mapping for common cryptos
const COINGECKO_IDS: Record<string, string> = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'SOL': 'solana',
  'XRP': 'ripple',
  'SUI': 'sui',
};

// Get cached prices if fresh
export const getCachedPrices = (): PriceCache | null => {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    
    const data: PriceCache = JSON.parse(cached);
    const lastUpdate = new Date(data.lastUpdated).getTime();
    const now = Date.now();
    
    // Return null if cache is stale
    if (now - lastUpdate > CACHE_DURATION_MS) return null;
    
    return data;
  } catch {
    return null;
  }
};

// Save prices to cache
export const savePriceCache = (prices: Record<string, PriceData>) => {
  const cache: PriceCache = {
    prices,
    lastUpdated: new Date().toISOString(),
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
};

// Fetch crypto prices from CoinGecko (free, no API key needed)
export const fetchCryptoPrices = async (symbols: string[]): Promise<Record<string, PriceData>> => {
  const ids = symbols
    .map(s => COINGECKO_IDS[s.toUpperCase()])
    .filter(Boolean)
    .join(',');
  
  if (!ids) return {};
  
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
    );
    
    if (!response.ok) throw new Error('CoinGecko API error');
    
    const data = await response.json();
    const prices: Record<string, PriceData> = {};
    
    // Map back to symbols
    symbols.forEach(symbol => {
      const id = COINGECKO_IDS[symbol.toUpperCase()];
      if (id && data[id]) {
        prices[symbol.toUpperCase()] = {
          symbol: symbol.toUpperCase(),
          price: data[id].usd,
          currency: 'USD',
          change24h: data[id].usd_24h_change,
          lastUpdated: new Date().toISOString(),
        };
      }
    });
    
    return prices;
  } catch (error) {
    console.error('Failed to fetch crypto prices:', error);
    return {};
  }
};

// Fetch stock prices from Yahoo Finance via JINA
export const fetchStockPrices = async (symbols: string[]): Promise<Record<string, PriceData>> => {
  const prices: Record<string, PriceData> = {};
  
  // Get JINA API key from environment
  const apiKey = import.meta.env.VITE_JINA_API_KEY || '';
  
  // Fetch each stock individually (Yahoo Finance pages are reliable)
  const promises = symbols.map(async (symbol) => {
    try {
      const url = `https://finance.yahoo.com/quote/${symbol.toUpperCase()}`;
      const headers: Record<string, string> = {};
      
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      
      const response = await fetch(`https://r.jina.ai/http://${url}`, { headers });
      const text = await response.text();
      
      // Extract current price - look for patterns like "$123.45" near the symbol
      // Yahoo Finance typically shows the price prominently
      const priceMatch = text.match(/\$([\d,]+\.?\d{0,2})/);
      const changeMatch = text.match(/([+-]?[\d.]+)%/);
      
      if (priceMatch) {
        const price = parseFloat(priceMatch[1].replace(',', ''));
        const change24h = changeMatch ? parseFloat(changeMatch[1]) : undefined;
        
        prices[symbol.toUpperCase()] = {
          symbol: symbol.toUpperCase(),
          price,
          currency: 'USD',
          change24h,
          lastUpdated: new Date().toISOString(),
        };
      }
    } catch (error) {
      console.error(`Failed to fetch ${symbol}:`, error);
    }
  });
  
  await Promise.all(promises);
  return prices;
};

// Fetch all prices (crypto + stocks)
export const fetchAllPrices = async (
  cryptoSymbols: string[] = [],
  stockSymbols: string[] = []
): Promise<Record<string, PriceData>> => {
  // Check cache first
  const cached = getCachedPrices();
  if (cached) {
    console.log('Using cached prices from', cached.lastUpdated);
    return cached.prices;
  }
  
  // Fetch fresh data
  const [cryptoPrices, stockPrices] = await Promise.all([
    fetchCryptoPrices(cryptoSymbols),
    fetchStockPrices(stockSymbols),
  ]);
  
  const allPrices = { ...cryptoPrices, ...stockPrices };
  
  // Save to cache
  savePriceCache(allPrices);
  
  return allPrices;
};

import { getFxRate } from '../hooks/useFxRate';

// Synchronous conversion using a caller-supplied rate. Use the React `useFxRate`
// hook (or `getFxRate` below) to obtain a live rate; pass it in here.
export const usdToAud = (usdAmount: number, rate: number): number => usdAmount * rate;

// Async USD→AUD using the live fx_rates cache. Convenient for non-React modules.
export const usdToAudLive = async (usdAmount: number): Promise<number> => {
  const { rate } = await getFxRate('USD', 'AUD');
  return usdAmount * rate;
};

// Format currency
export const formatCurrency = (value: number, currency: string = 'USD'): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};
