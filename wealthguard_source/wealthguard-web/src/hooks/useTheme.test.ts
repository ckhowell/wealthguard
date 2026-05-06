import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTheme } from './useTheme';

describe('useTheme', () => {
  it('applies the `dark` class on html when mode is dark', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('clears the `dark` class when mode is light', () => {
    document.documentElement.classList.add('dark');
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode('light'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggles between light and dark', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode('light'));
    act(() => result.current.toggle());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    act(() => result.current.toggle());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
