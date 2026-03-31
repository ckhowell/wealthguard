import { useState, useEffect } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { convertCurrency, formatCurrency, FX_RATES } from '../services/priceServiceEnhanced';

const CURRENCIES = [
  { code: 'AUD', name: 'Australian Dollar', flag: '🇦🇺' },
  { code: 'USD', name: 'US Dollar', flag: '🇺🇸' },
  { code: 'JPY', name: 'Japanese Yen', flag: '🇯🇵' },
  { code: 'EUR', name: 'Euro', flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', flag: '🇬🇧' },
];

interface CurrencyConverterProps {
  defaultAmount?: number;
  defaultFrom?: string;
  defaultTo?: string;
}

const CurrencyConverter = ({ 
  defaultAmount = 50000, 
  defaultFrom = 'JPY',
  defaultTo = 'AUD'
}: CurrencyConverterProps) => {
  const [amount, setAmount] = useState(defaultAmount);
  const [fromCurrency, setFromCurrency] = useState(defaultFrom);
  const [toCurrency, setToCurrency] = useState(defaultTo);
  const [converted, setConverted] = useState(0);
  const [rate, setRate] = useState(0);
  const [lastUpdated] = useState(new Date());

  useEffect(() => {
    const result = convertCurrency(amount, fromCurrency, toCurrency);
    setConverted(result);
    
    // Calculate rate
    const rateKey = `${fromCurrency}/${toCurrency}`;
    const rateValue = FX_RATES[rateKey];
    if (rateValue) {
      setRate(rateValue);
    } else {
      const inverse = `${toCurrency}/${fromCurrency}`;
      const inverseRate = FX_RATES[inverse];
      if (inverseRate) setRate(1 / inverseRate);
    }
  }, [amount, fromCurrency, toCurrency]);

  const handleSwap = () => {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
  };

  const formatRate = () => {
    if (rate >= 1) {
      return `1 ${fromCurrency} = ${rate.toFixed(4)} ${toCurrency}`;
    } else {
      return `1 ${toCurrency} = ${(1 / rate).toFixed(2)} ${fromCurrency}`;
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-800">Currency Converter</h3>
        <span className="text-xs text-slate-500">
          Updated: {lastUpdated.toLocaleTimeString()}
        </span>
      </div>

      <div className="space-y-4">
        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
            className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter amount"
          />
        </div>

        {/* Currency Selection */}
        <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">From</label>
            <select
              value={fromCurrency}
              onChange={(e) => setFromCurrency(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
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
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            title="Swap currencies"
          >
            <ArrowRightLeft className="w-5 h-5 text-slate-400" />
          </button>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">To</label>
            <select
              value={toCurrency}
              onChange={(e) => setToCurrency(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.code} - {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Result */}
        <div className="bg-slate-50 rounded-lg p-4 text-center">
          <p className="text-sm text-slate-500 mb-1">Converted Amount</p>
          <p className="text-3xl font-bold text-slate-800">
            {formatCurrency(converted, toCurrency)}
          </p>
          <p className="text-sm text-slate-500 mt-2">{formatRate()}</p>
        </div>

        {/* Quick Reference */}
        <div className="pt-4 border-t border-slate-100">
          <p className="text-sm font-medium text-slate-700 mb-2">Quick Reference</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between px-3 py-2 bg-slate-50 rounded">
              <span className="text-slate-600">100 JPY → AUD</span>
              <span className="font-medium">${(100 * FX_RATES['JPY/AUD']).toFixed(2)}</span>
            </div>
            <div className="flex justify-between px-3 py-2 bg-slate-50 rounded">
              <span className="text-slate-600">$100 USD → AUD</span>
              <span className="font-medium">${(100 * FX_RATES['USD/AUD']).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CurrencyConverter;
