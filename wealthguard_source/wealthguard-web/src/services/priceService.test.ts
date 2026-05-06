import { describe, expect, it } from 'vitest';
import { formatCurrency, usdToAud } from './priceService';

describe('priceService', () => {
  it('formatCurrency produces a locale-aware currency string', () => {
    const out = formatCurrency(1234.5, 'USD');
    expect(out).toContain('1,234.50');
  });

  it('usdToAud multiplies by the provided rate', () => {
    expect(usdToAud(100, 1.5)).toBe(150);
    expect(usdToAud(0, 2)).toBe(0);
  });
});
