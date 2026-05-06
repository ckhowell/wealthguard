import { useEffect, useState } from 'react';

export interface StakingItem {
  source: string;          // "ETH staking" | "SOL staking"
  address: string;
  monthly_aud: number;
  basis: string;
}

export interface InterestItem {
  account: string;
  balance_aud: number;
  apy_pct: number;
  monthly_aud: number;
}

export interface IncomeMix {
  total_monthly: number;
  nicole_monthly: number;
  nicole_monthly_min: number;
  nicole_monthly_max: number;
  interest_monthly: number;
  staking_monthly: number;                  // crypto staking total (ETH + SOL)
  txn_income_monthly: number;
  baseline_living: number;
  net_surplus_per_month: number;            // income − living spend
  opportunity_monthly_aud: number;          // uplift if idle cash moved to best APY
  interest_breakdown: InterestItem[];
  staking_breakdown: StakingItem[];
  loading: boolean;
}

/**
 * Shared hook — fetches /api/advisor/runway once and derives a compact income
 * summary.  Exposes full breakdowns (interest by account, staking by source)
 * so any page can surface the right slice without re-requesting the runway
 * payload.
 */
export function useIncome(): IncomeMix {
  const [state, setState] = useState<IncomeMix>({
    total_monthly: 0,
    nicole_monthly: 0,
    nicole_monthly_min: 0,
    nicole_monthly_max: 0,
    interest_monthly: 0,
    staking_monthly: 0,
    txn_income_monthly: 0,
    baseline_living: 0,
    net_surplus_per_month: 0,
    opportunity_monthly_aud: 0,
    interest_breakdown: [],
    staking_breakdown: [],
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/advisor/runway')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const si = d.structured_income ?? {};
        const living = d.baseline_living ?? 0;
        const total = si.total_monthly ?? 0;
        setState({
          total_monthly: total,
          nicole_monthly: si.nicole_monthly ?? 0,
          nicole_monthly_min: si.nicole_monthly_min ?? si.nicole_monthly ?? 0,
          nicole_monthly_max: si.nicole_monthly_max ?? si.nicole_monthly ?? 0,
          interest_monthly: si.interest_monthly ?? 0,
          staking_monthly: si.staking_monthly ?? 0,
          txn_income_monthly: si.txn_income_monthly ?? 0,
          baseline_living: living,
          net_surplus_per_month: total - living,
          opportunity_monthly_aud: si.opportunity_monthly_aud ?? 0,
          interest_breakdown: Array.isArray(si.interest_breakdown) ? si.interest_breakdown : [],
          staking_breakdown: Array.isArray(si.staking_breakdown) ? si.staking_breakdown : [],
          loading: false,
        });
      })
      .catch(() => setState((s) => ({ ...s, loading: false })));
    return () => { cancelled = true; };
  }, []);

  return state;
}
