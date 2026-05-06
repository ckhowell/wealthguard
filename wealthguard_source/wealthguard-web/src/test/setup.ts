import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Reset DOM between tests so <html class="dark"> etc. doesn't leak.
afterEach(() => {
  cleanup();
  localStorage.clear();
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('dark');
  }
});

// matchMedia isn't implemented in jsdom — stub it for useTheme and others.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
