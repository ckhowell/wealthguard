import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface Handlers {
  onCommand: () => void;
  onHelp: () => void;
}

const G_ROUTES: Record<string, string> = {
  d: '/',
  p: '/portfolio',
  m: '/markets',
  a: '/advisor',
  i: '/import',
  g: '/goals',
  t: '/transactions',
  s: '/settings',
  b: '/budgets',
  r: '/rebalancer',
};

function isTypingContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts({ onCommand, onHelp }: Handlers) {
  const navigate = useNavigate();

  useEffect(() => {
    let pendingG = false;
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

    const clearPending = () => {
      pendingG = false;
      if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        pendingTimeout = null;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K always opens the palette, even inside inputs.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onCommand();
        return;
      }

      if (isTypingContext(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // `?` shows shortcut cheatsheet. Works without shift on most layouts.
      if (e.key === '?') {
        e.preventDefault();
        onHelp();
        return;
      }

      // `/` focuses a global search — we interpret it as "open palette".
      if (e.key === '/') {
        e.preventDefault();
        onCommand();
        return;
      }

      if (e.key === 'Escape') {
        clearPending();
        return;
      }

      const lower = e.key.toLowerCase();

      if (pendingG && G_ROUTES[lower]) {
        e.preventDefault();
        navigate(G_ROUTES[lower]);
        clearPending();
        return;
      }

      if (lower === 'g') {
        pendingG = true;
        pendingTimeout = setTimeout(clearPending, 900);
      } else {
        clearPending();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearPending();
    };
  }, [navigate, onCommand, onHelp]);
}
