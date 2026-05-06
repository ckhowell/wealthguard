import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SECTIONS: { heading: string; items: { keys: string; label: string }[] }[] = [
  {
    heading: 'Global',
    items: [
      { keys: '⌘K  /  Ctrl K', label: 'Open command palette' },
      { keys: '/', label: 'Focus search (opens palette)' },
      { keys: '?', label: 'This cheatsheet' },
      { keys: 'Esc', label: 'Close dialogs' },
    ],
  },
  {
    heading: 'Navigation (press g then…)',
    items: [
      { keys: 'g d', label: 'Dashboard' },
      { keys: 'g p', label: 'Portfolio' },
      { keys: 'g r', label: 'Rebalancer' },
      { keys: 'g m', label: 'Markets' },
      { keys: 'g a', label: 'Advisor' },
      { keys: 'g t', label: 'Transactions' },
      { keys: 'g i', label: 'Import CSV' },
      { keys: 'g b', label: 'Budgets' },
      { keys: 'g g', label: 'Goals' },
      { keys: 'g s', label: 'Settings' },
    ],
  },
];

const ShortcutsCheatsheet = ({ open, onClose }: Props) => {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        aria-label="Keyboard shortcuts"
        className="w-full max-w-md bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100 dark:border-stone-800">
          <h2 className="text-base font-semibold text-stone-800 dark:text-stone-100">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800"
            aria-label="Close shortcuts"
          >
            <X className="w-4 h-4 text-stone-500 dark:text-stone-400" />
          </button>
        </div>
        <div className="p-5 space-y-5">
          {SECTIONS.map((s) => (
            <section key={s.heading}>
              <h3 className="text-xs uppercase tracking-wide text-stone-400 dark:text-stone-500 mb-2">
                {s.heading}
              </h3>
              <ul className="space-y-1.5 text-base">
                {s.items.map((i) => (
                  <li key={i.keys} className="flex items-center justify-between gap-3">
                    <span className="text-stone-700 dark:text-stone-200">{i.label}</span>
                    <kbd className="font-mono text-xs px-2 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200">
                      {i.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ShortcutsCheatsheet;
