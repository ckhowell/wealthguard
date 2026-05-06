// Thin fetch wrapper that injects the WealthGuard shared-secret header
// when the user has stored one. The backend ignores the header unless
// WEALTHGUARD_PASSWORD is set server-side, so this is safe to always send.

const STORAGE_KEY = 'wealthguard-password';

export function getStoredPassword(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setStoredPassword(value: string): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* quota / private mode — ignore */
  }
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const pw = getStoredPassword();
  if (pw && !headers.has('x-wg-password')) {
    headers.set('x-wg-password', pw);
  }
  return fetch(input, { ...init, headers });
}
