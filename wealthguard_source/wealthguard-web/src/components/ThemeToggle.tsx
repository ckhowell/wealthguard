import { Moon, Sun, Laptop } from 'lucide-react';
import { useTheme, type ThemeMode } from '../hooks/useTheme';

const OPTIONS: { value: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Laptop },
];

const ThemeToggle = () => {
  const { mode, setMode } = useTheme();

  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 p-0.5 rounded-lg border border-stone-200 bg-white dark:bg-stone-800 dark:border-stone-700"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={active}
            title={label}
            className={`p-1.5 rounded-md transition-colors ${
              active
                ? 'bg-stone-100 text-stone-800 dark:bg-stone-700 dark:text-white'
                : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50 dark:bg-stone-800 dark:text-stone-400 dark:hover:text-stone-100 dark:hover:bg-stone-700/50'
            }`}
          >
            <Icon className="w-4 h-4" />
          </button>
        );
      })}
    </div>
  );
};

export default ThemeToggle;
