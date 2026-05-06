import { useEffect, useState } from 'react';
import TabBar from '../components/TabBar';
import { ExpenseAnalysisView } from './ExpenseAnalysis';
import { CashFlowView } from './CashFlow';
import { BudgetsView } from './Budgets';

/**
 * Spending — consolidated host for the three previously-separate spending
 * surfaces: Expense Analysis (Iteration-17 rebuild), Cash Flow, and Budgets.
 *
 * Each child page exports a named `*View` component that is the same
 * component as its default export — pure render reuse, no internals changed.
 * The Iteration-17 ExpenseAnalysis range picker, sortable categories table,
 * etc. all flow through unchanged.
 *
 * Tab state is kept in sync with `?tab=` URL param via history.replaceState
 * (no navigate — switching tabs shouldn't push history entries). Default
 * tab is `analysis` because it's the highest-value of the three for the
 * user's daily flow.
 */
type SpendingTab = 'analysis' | 'cashflow' | 'budgets';

const VALID_TABS: readonly SpendingTab[] = ['analysis', 'cashflow', 'budgets'];

const tabFromUrl = (): SpendingTab => {
  if (typeof window === 'undefined') return 'analysis';
  const v = new URLSearchParams(window.location.search).get('tab');
  return (VALID_TABS as readonly string[]).includes(v ?? '') ? (v as SpendingTab) : 'analysis';
};

const Spending = () => {
  const [tab, setTab] = useState<SpendingTab>(tabFromUrl);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (tab === 'analysis') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url.toString());
  }, [tab]);

  return (
    <div>
      <div className="px-6 pt-6 max-w-[1400px] mx-auto">
        <TabBar<SpendingTab>
          ariaLabel="Spending sub-views"
          tabs={[
            { id: 'analysis', label: 'Analysis',  hint: 'Range-based spending breakdown: categories, merchants, trend' },
            { id: 'cashflow', label: 'Cash Flow', hint: 'Money in vs out, net surplus, coverage ratio' },
            { id: 'budgets',  label: 'Budgets',   hint: 'Per-category budget vs actual' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>
      {tab === 'analysis' && <ExpenseAnalysisView />}
      {tab === 'cashflow' && <CashFlowView />}
      {tab === 'budgets'  && <BudgetsView />}
    </div>
  );
};

export default Spending;
