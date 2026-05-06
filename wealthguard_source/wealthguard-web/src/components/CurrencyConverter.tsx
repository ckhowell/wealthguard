import { useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { formatCurrency } from '../services/priceServiceEnhanced';
import { useFxRate } from '../hooks/useFxRate';
import type { Currency } from '../types/api';

const CURRENCIES: { code: Currency; name: string; flag: string }[] = [
  { code: 'AUD', name: 'Australian Dollar', flag: '🇦🇺' },
  { code: 'USD', name: 'US Dollar', flag: '🇺🇸' },
  { code: 'JPY', name: 'Japanese Yen', flag: '🇯🇵' },
  { code: 'EUR', name: 'Euro', flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', flag: '🇬🇧' },
];

interface CurrencyConverterProps {
  defaultAmount?: number;
  defaultFrom?: Currency;
  defaultTo?: Currency;
}

const CurrencyConverter = ({
  defaultAmount = 50000,
  defaultFrom = 'JPY',
  defaultTo = 'AUD',
}: CurrencyConverterProps) => {
  const [amount, setAmount] = useState(defaultAmount);
  const [fromCurrency, setFromCurrency] = useState<Currency>(defaultFrom);
  const [toCurrency, setToCurrency] = useState<Currency>(defaultTo);

  const fx = useFxRate(fromCurrency, toCurrency);
  const jpyAud = useFxRate('JPY', 'AUD');
  const usdAud = useFxRate('USD', 'AUD');

  const converted = amount * fx.rate;

  const handleSwap = () => {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
  };

  const formatRate = () => {
    if (fx.rate >= 1) return `1 ${fromCurrency} = ${fx.rate.toFixed(4)} ${toCurrency}`;
    return `1 ${toCurrency} = ${(1 / fx.rate).toFixed(2)} ${fromCurrency}`;
  };

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">Currency Converter</h3>
        <span className="text-xs text-stone-500 dark:text-stone-400">
          {fx.asOf ? `As of ${new Date(fx.asOf).toLocaleString()}` : 'Live rate'}
          {fx.source === 'fallback' && ' · static fallback'}
        </span>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-base text-stone-600 dark:text-stone-300 mb-1">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
            className="w-full px-4 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            placeholder="Enter amount"
          />
        </div>

        <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-end">
          <div>
            <label className="block text-base text-stone-600 dark:text-stone-300 mb-1">From</label>
            <select
              value={fromCurrency}
              onChange={(e) => setFromCurrency(e.target.value as Currency)}
              className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:ring-2 focus:ring-cyan-500"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.code} - {c.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleSwap}
            className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg transition-colors"
            title="Swap currencies"
            aria-label="Swap currencies"
          >
            <ArrowRightLeft className="w-5 h-5 text-stone-400" />
          </button>

          <div>
            <label className="block text-base text-stone-600 dark:text-stone-300 mb-1">To</label>
            <select
              value={toCurrency}
              onChange={(e) => setToCurrency(e.target.value as Currency)}
              className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:ring-2 focus:ring-cyan-500"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.code} - {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-stone-50 dark:bg-stone-800 rounded-lg p-4 text-center">
          <p className="text-base text-stone-500 dark:text-stone-400 mb-1">Converted Amount</p>
          <p className="text-3xl font-bold text-stone-800 dark:text-stone-100">{formatCurrency(converted, toCurrency)}</p>
          <p className="text-base text-stone-500 dark:text-stone-400 mt-2">{formatRate()}</p>
        </div>

        <div className="pt-4 border-t border-stone-100 dark:border-stone-800">
          <p className="text-base text-stone-700 dark:text-stone-200 mb-2">Quick Reference</p>
          <div className="grid grid-cols-2 gap-2 text-base">
            <div className="flex justify-between px-3 py-2 bg-stone-50 dark:bg-stone-800 rounded">
              <span className="text-stone-600 dark:text-stone-300">100 JPY → AUD</span>
              <span>${(100 * jpyAud.rate).toFixed(2)}</span>
            </div>
            <div className="flex justify-between px-3 py-2 bg-stone-50 dark:bg-stone-800 rounded">
              <span className="text-stone-600 dark:text-stone-300">$100 USD → AUD</span>
              <span>${(100 * usdAud.rate).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CurrencyConverter;
