import type { ReactNode } from 'react';

/**
 * TabBar — shared sub-navigation pattern, extracted from the PodBits page so
 * pages that consolidate multiple sub-views (Plan/Projects, Spending) share a
 * single visual language and a single keyboard/a11y model.
 *
 * Visual: WattVision underline-tab style — bottom-border indicator, cyan-500
 * for the active tab, neutral stone for inactive, hover on inactive only.
 * No animation beyond the default `transition` on color/border (the parent
 * page is responsible for any content-fade transition).
 *
 * Generic over the tab id so callers can use string literal unions and get
 * full typecheck on `active`/`onChange` pairs:
 *
 *   type Tab = 'plan' | 'projects';
 *   <TabBar<Tab>
 *     tabs={[{ id: 'plan', label: 'Plan' }, { id: 'projects', label: 'Projects' }]}
 *     active={tab}
 *     onChange={setTab}
 *   />
 */
interface TabSpec<T extends string> {
  id: T;
  label: string;
  /** Optional small badge (e.g. unread count). Renders as a stone pill next to the label. */
  count?: number | null;
  /** Title attribute for hover hint. */
  hint?: string;
}

interface TabBarProps<T extends string> {
  tabs: readonly TabSpec<T>[];
  active: T;
  onChange: (id: T) => void;
  /** Optional right-aligned slot — useful for a Refresh button or a status chip. */
  rightSlot?: ReactNode;
  /** Accessible label for the nav region. Defaults to "Sub-navigation". */
  ariaLabel?: string;
}

export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
  rightSlot,
  ariaLabel = 'Sub-navigation',
}: TabBarProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex items-center gap-4 border-b border-stone-200 dark:border-stone-800"
    >
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            title={t.hint}
            className={`px-1 py-2.5 text-base tracking-tight transition border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 rounded-t ${
              isActive
                ? 'border-cyan-500 text-stone-900 dark:text-stone-50'
                : 'border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
            }`}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 text-xs font-mono rounded-full bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
                {t.count}
              </span>
            )}
          </button>
        );
      })}
      {rightSlot && <div className="ml-auto">{rightSlot}</div>}
    </div>
  );
}

export default TabBar;
