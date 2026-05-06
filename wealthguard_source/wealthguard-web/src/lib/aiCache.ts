/**
 * Shared types + helpers for the Iteration 22 manual-gating pattern on AI
 * endpoints. Every /api/intel/* + /api/advisor/narrative endpoint accepts a
 * `cache_only=true` query param. When set, the backend returns the cached
 * payload (fresh OR stale, decorated with `_cached_at` / `_age_seconds` /
 * `_stale`) without firing Kimi/Gemini, OR `{ cached: false }` if no cache
 * exists yet.
 *
 * Frontend pattern in each AI card:
 *   1. Mount → fetch with `?cache_only=true` (free, instant)
 *   2. If `cached === false` → render empty state with "Run analysis" button
 *   3. Otherwise render the cached payload + age badge
 *   4. Button click → fetch with `?force=true` to actually spend tokens
 *
 * This file is the single source of truth for those types and the age
 * formatter so the 6 AI cards stay consistent.
 */
export interface CacheMeta {
  /** Backend stub when no cache exists yet. Mutually exclusive with the
   *  decoration fields. */
  cached?: false;
  /** ISO 8601 UTC timestamp of when the cached payload was computed. */
  _cached_at?: string | null;
  /** Seconds since `_cached_at`, server-computed at response time. */
  _age_seconds?: number;
  /** True when the cached payload is older than the endpoint's TTL — still
   *  shown to the user but flagged so they know to consider re-running. */
  _stale?: boolean;
}

/** Compact human age renderer: "12s ago" / "5m ago" / "2h ago" / "3d ago". */
export const fmtAge = (sec: number): string => {
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
};

/** Convenience: build the right query string for an AI endpoint based on
 *  whether the caller wants a fresh run or a cache-only peek. */
export const aiQueryString = (mode: 'mount' | 'fresh', extra?: Record<string, string>): string => {
  const params = new URLSearchParams(extra ?? {});
  if (mode === 'fresh') params.set('force', 'true');
  else params.set('cache_only', 'true');
  return `?${params.toString()}`;
};
