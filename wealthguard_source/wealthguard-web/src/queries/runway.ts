import { useQuery } from '@tanstack/react-query';
import { runwayKey } from './accounts';

/**
 * Runway query — the canonical income/spend/burn endpoint that drives the
 * Dashboard SurvivalCockpit + Advisor narrative. Cached under the `runway`
 * key so a single account edit (which updates the account balance)
 * invalidates this and forces the cockpit to recompute.
 *
 * Default args mirror what the Dashboard already uses: 12 months back for
 * historical context, 3-month window for the recurring-living baseline.
 */
async function fetchRunway() {
  const r = await fetch('/api/advisor/runway?months_back=12&living_window=3');
  if (!r.ok) throw new Error(`/api/advisor/runway ${r.status}`);
  return r.json();
}

export function useRunway() {
  return useQuery({ queryKey: runwayKey, queryFn: fetchRunway });
}
