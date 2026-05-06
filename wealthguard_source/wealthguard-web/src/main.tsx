import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { getStoredPassword } from './services/apiClient'

// Single QueryClient instance shared across the whole app. Defaults are tuned
// for a single-user dashboard: stale-after-30s so the same query call from
// multiple components shares one in-flight request, but fresh enough to feel
// live; refetch on window focus so flipping back to the tab from external
// banking apps refreshes; one retry on transient errors. Mutations fire
// invalidations via queryClient.invalidateQueries (see src/queries/*.ts) which
// is what makes the header chip + Dashboard cockpit + Portfolio table update
// in lock-step after a single account edit.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

// Inject the WealthGuard shared-secret header on every /api/* fetch so that
// when WEALTHGUARD_PASSWORD is set on the backend, no existing caller needs
// to be rewritten. The backend only reads x-wg-password when that env var is
// present, so this is a no-op otherwise.
const _originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith('/api/')) {
    return _originalFetch(input, init);
  }
  const pw = getStoredPassword();
  if (!pw) {
    return _originalFetch(input, init);
  }
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('x-wg-password')) headers.set('x-wg-password', pw);
  return _originalFetch(input, { ...init, headers });
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
