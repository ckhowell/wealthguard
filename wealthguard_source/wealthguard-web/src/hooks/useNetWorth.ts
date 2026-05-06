import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Holding, NetWorthSnapshot } from '../types/api';
import { netWorthKey } from '../queries/accounts';

export interface NetWorth {
  valueAud: number;
  costAud: number;
  gainLossAud: number;
  gainLossPct: number;
  holdingsCount: number;
  investmentsAud: number;
  cashAud: number;
  liabilitiesAud: number;
  lastUpdated: string | null;
  deltaPct30d: number | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

interface LiveBreakdown {
  investments_aud: number;
  cash_aud: number;
  liabilities_aud: number;
  assets_aud: number;
  net_worth_aud: number;
  last_updated: string | null;
}

interface NetWorthBundle {
  live: LiveBreakdown;
  holdings: Holding[];
  history: NetWorthSnapshot[];
}

// Only trust the 30-day delta if the base snapshot is within a plausible band
// of the current value. History starts sparse (seed rows can be < 50% of the
// current number), which otherwise produces nonsense deltas like "+119%".
const MIN_DELTA_BASE_RATIO = 0.7;
const MAX_DELTA_BASE_RATIO = 1.5;

/**
 * Fetch the three endpoints that compose the header chip's net-worth picture
 * in a single query bundle. One query key (`netWorthKey`) means a single
 * mutation invalidation refreshes all three at once — that's what makes
 * cross-page live updates work after an account edit.
 */
async function fetchNetWorth(): Promise<NetWorthBundle> {
  const [lRes, hRes, nRes] = await Promise.all([
    fetch('/api/net-worth/live'),
    fetch('/api/holdings'),
    fetch('/api/net-worth/history?days=35').catch(() => null),
  ]);
  if (!lRes.ok) throw new Error(`/api/net-worth/live ${lRes.status}`);
  const live: LiveBreakdown = await lRes.json();
  const holdings: Holding[] = hRes.ok ? await hRes.json() : [];
  const history: NetWorthSnapshot[] = nRes && nRes.ok ? await nRes.json() : [];
  return { live, holdings, history };
}

/**
 * `useNetWorth` — drives the App.tsx header chip + Dashboard NW deltas + any
 * other surface that needs the canonical net-worth view. Now backed by
 * @tanstack/react-query so a single mutation in `useUpdateAccount` (or any
 * future write that invalidates `netWorthKey`) triggers a refetch and every
 * mounted consumer re-renders in lock-step.
 *
 * Return shape preserved from the original hook so existing call sites (App
 * header, Dashboard, etc.) need no changes.
 */
export function useNetWorth(): NetWorth {
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: netWorthKey,
    queryFn: fetchNetWorth,
    // 60-second poll preserved from the legacy implementation so prices /
    // staking / FX naturally drift in even without an explicit edit.
    refetchInterval: 60_000,
  });

  const live = data?.live;
  const holdings = data?.holdings ?? [];
  const history = data?.history ?? [];

  const valueAud = live?.net_worth_aud ?? 0;
  const investmentsAud = live?.investments_aud ?? 0;
  const cashAud = live?.cash_aud ?? 0;
  const liabilitiesAud = live?.liabilities_aud ?? 0;

  // Gain/loss is a property of the *investments* basket — cash has no cost
  // basis. Keep this scoped to holdings so the headline stays honest.
  const costAud = holdings.reduce((s, h) => {
    const costOriginal = (h.cost_basis_per_share ?? 0) * (h.shares ?? 0);
    const fx = h.value_original > 0 ? h.value_aud / h.value_original : 1;
    return s + costOriginal * fx;
  }, 0);
  const gainLossAud = investmentsAud - costAud;
  const gainLossPct = costAud > 0 ? (gainLossAud / costAud) * 100 : 0;

  // 30-day delta: only compute when we have a snapshot from ~30 days ago that
  // is in the same order of magnitude as the current value. Partial seed rows
  // (e.g. $1.4M vs $3.2M today) produce meaningless +100% bumps otherwise.
  let deltaPct30d: number | null = null;
  if (history.length >= 2 && valueAud > 0) {
    const oldest = history[0].net_worth;
    const ratio = oldest > 0 ? oldest / valueAud : 0;
    if (ratio >= MIN_DELTA_BASE_RATIO && ratio <= MAX_DELTA_BASE_RATIO) {
      deltaPct30d = ((valueAud - oldest) / oldest) * 100;
    }
  }

  const lastUpdated =
    live?.last_updated ??
    holdings.reduce<string | null>((acc, h) => {
      if (!h.last_price_update) return acc;
      if (!acc || h.last_price_update > acc) return h.last_price_update;
      return acc;
    }, null);

  return {
    valueAud,
    costAud,
    gainLossAud,
    gainLossPct,
    holdingsCount: holdings.length,
    investmentsAud,
    cashAud,
    liabilitiesAud,
    lastUpdated,
    deltaPct30d,
    isLoading: isPending,
    error: error instanceof Error ? error.message : null,
    refresh: () => qc.invalidateQueries({ queryKey: netWorthKey }),
  };
}
