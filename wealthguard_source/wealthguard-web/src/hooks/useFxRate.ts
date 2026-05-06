import { useEffect, useState } from 'react';
import type { Currency } from '../types/api';

interface FxRateState {
  rate: number;
  asOf: string | null;
  source: string;
  isLoading: boolean;
  isStale: boolean;
  error: string | null;
}

interface CacheEntry {
  rate: number;
  asOf: string | null;
  source: string;
  fetchedAt: number;
}

const CACHE_KEY = 'wealthguard-fx-cache-v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

const FALLBACKS: Record<string, number> = {
  'USD/AUD': 1.55,
  'AUD/USD': 0.645,
  'AUD/JPY': 109.89,
  'JPY/AUD': 0.009117,
};

function readCache(): Record<string, CacheEntry> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CacheEntry>) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CacheEntry>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore quota errors */
  }
}

function fallbackRate(from: string, to: string): number {
  if (from === to) return 1;
  const direct = FALLBACKS[`${from}/${to}`];
  if (direct) return direct;
  const inverse = FALLBACKS[`${to}/${from}`];
  if (inverse) return 1 / inverse;
  return 1;
}

export async function getFxRate(from: Currency, to: Currency): Promise<CacheEntry> {
  const key = `${from}/${to}`;
  const cache = readCache();
  const cached = cache[key];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }
  try {
    const res = await fetch(`/api/fx-rates/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (!res.ok) throw new Error(`fx ${res.status}`);
    const data: { rate: number; recorded_at: string | null; source: string | null } = await res.json();
    const entry: CacheEntry = {
      rate: data.rate,
      asOf: data.recorded_at,
      source: data.source ?? 'live',
      fetchedAt: Date.now(),
    };
    cache[key] = entry;
    writeCache(cache);
    return entry;
  } catch {
    return {
      rate: cached?.rate ?? fallbackRate(from, to),
      asOf: cached?.asOf ?? null,
      source: cached ? cached.source : 'fallback',
      fetchedAt: Date.now(),
    };
  }
}

export function useFxRate(from: Currency, to: Currency): FxRateState {
  const [state, setState] = useState<FxRateState>(() => {
    const cache = readCache();
    const cached = cache[`${from}/${to}`];
    return {
      rate: cached?.rate ?? fallbackRate(from, to),
      asOf: cached?.asOf ?? null,
      source: cached?.source ?? 'fallback',
      isLoading: !cached,
      isStale: cached ? Date.now() - cached.fetchedAt >= CACHE_TTL_MS : true,
      error: null,
    };
  });

  useEffect(() => {
    let cancelled = false;
    getFxRate(from, to)
      .then((entry) => {
        if (cancelled) return;
        setState({
          rate: entry.rate,
          asOf: entry.asOf,
          source: entry.source,
          isLoading: false,
          isStale: false,
          error: null,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: e instanceof Error ? e.message : 'Failed to load FX rate',
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  return state;
}
