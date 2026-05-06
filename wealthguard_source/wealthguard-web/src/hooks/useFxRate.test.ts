import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFxRate, useFxRate } from './useFxRate';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getFxRate', () => {
  it('returns live rate from /api/fx-rates/latest and caches it', async () => {
    const payload = { rate: 1.5234, recorded_at: '2026-04-01T00:00:00Z', source: 'live' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );

    const first = await getFxRate('USD', 'AUD');
    expect(first.rate).toBe(1.5234);
    expect(first.source).toBe('live');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call within TTL: cached, no extra fetch.
    const second = await getFxRate('USD', 'AUD');
    expect(second.rate).toBe(1.5234);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to a static rate when the API fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const entry = await getFxRate('USD', 'AUD');
    expect(entry.source).toBe('fallback');
    expect(entry.rate).toBeGreaterThan(1);
  });
});

describe('useFxRate', () => {
  it('initializes with the fallback rate before the API resolves', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ rate: 2, recorded_at: null, source: 'live' }), { status: 200 }),
    );
    const { result } = renderHook(() => useFxRate('USD', 'AUD'));
    expect(result.current.rate).toBeGreaterThan(0);
    await waitFor(() => expect(result.current.rate).toBe(2));
  });
});
