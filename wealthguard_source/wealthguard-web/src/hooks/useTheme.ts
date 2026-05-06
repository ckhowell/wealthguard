import { useCallback, useEffect } from 'react';
import { usePersistentState } from './usePersistentState';

export type ThemeMode = 'light' | 'dark' | 'system';

function prefersDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const shouldBeDark = mode === 'dark' || (mode === 'system' && prefersDark());
  document.documentElement.classList.toggle('dark', shouldBeDark);
}

export interface UseThemeResult {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

export function useTheme(): UseThemeResult {
  const [mode, setMode] = usePersistentState<ThemeMode>('wealthguard-theme', 'system');

  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, [setMode]);

  const isDark =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  return { mode, isDark, setMode, toggle };
}
