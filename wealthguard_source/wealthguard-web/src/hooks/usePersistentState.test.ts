import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePersistentState } from './usePersistentState';

describe('usePersistentState', () => {
  it('seeds from localStorage when present', () => {
    localStorage.setItem('my-key', JSON.stringify({ hello: 'world' }));
    const { result } = renderHook(() => usePersistentState('my-key', { hello: '' }));
    expect(result.current[0]).toEqual({ hello: 'world' });
  });

  it('falls back to the initial value on missing or bad JSON', () => {
    localStorage.setItem('bad-key', 'not-json');
    const { result } = renderHook(() => usePersistentState('bad-key', 42));
    expect(result.current[0]).toBe(42);
  });

  it('persists updates to localStorage', () => {
    const { result } = renderHook(() => usePersistentState('counter', 0));
    act(() => result.current[1](5));
    expect(JSON.parse(localStorage.getItem('counter')!)).toBe(5);
  });
});
