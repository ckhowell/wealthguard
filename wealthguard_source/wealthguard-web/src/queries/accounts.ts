import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Account } from '../types/api';

/**
 * Accounts query module.
 *
 * One canonical place for the `accounts` server-state cache. Every page that
 * needs the accounts list calls `useAccounts()` and shares the same in-flight
 * request + cache. After a mutation (`useUpdateAccount`, `useCreateAccount`),
 * we invalidate this key plus the other keys that derive from accounts data
 * (net worth, runway) so every consumer refetches in lock-step. That's what
 * makes the header chip + Dashboard cockpit cash KPI + Portfolio table all
 * update simultaneously after a single edit, without any per-page coordination.
 */
export const accountsKey = ['accounts'] as const;
export const netWorthKey = ['netWorth'] as const;
export const runwayKey = ['runway'] as const;

async function fetchAccounts(): Promise<Account[]> {
  const r = await fetch('/api/accounts');
  if (!r.ok) throw new Error(`/api/accounts ${r.status}`);
  return r.json();
}

export function useAccounts() {
  return useQuery({ queryKey: accountsKey, queryFn: fetchAccounts });
}

interface UpdateAccountVars {
  id: number;
  body: Partial<Account>;
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: UpdateAccountVars) => {
      const r = await fetch(`/api/accounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`Save failed (${r.status}): ${text || r.statusText}`);
      }
      return r.json();
    },
    onSuccess: () => {
      // Cross-cache invalidation. As we migrate more queries to React Query
      // (holdings, plan, etc.) add their keys here so a single account edit
      // refreshes them too.
      qc.invalidateQueries({ queryKey: accountsKey });
      qc.invalidateQueries({ queryKey: netWorthKey });
      qc.invalidateQueries({ queryKey: runwayKey });
    },
  });
}

interface CreateAccountVars {
  body: Partial<Account>;
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ body }: CreateAccountVars) => {
      const r = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`Create failed (${r.status}): ${text || r.statusText}`);
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountsKey });
      qc.invalidateQueries({ queryKey: netWorthKey });
      qc.invalidateQueries({ queryKey: runwayKey });
    },
  });
}
