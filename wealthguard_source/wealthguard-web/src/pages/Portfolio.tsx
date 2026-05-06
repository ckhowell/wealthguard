import { useState, useEffect, useMemo } from 'react';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import {
  ArrowUpRight, ArrowDownRight, Building2, Car, Bitcoin, LineChart,
  Plus, Edit2, Trash2, X, Wallet, Home, PieChart as PieChartIcon
} from 'lucide-react';
import { useToast } from '../hooks/usePersistentState';
import ToastContainer from '../components/ToastContainer';
import RiskAnalysis from '../components/RiskAnalysis';
import HoldingNewsPopover from '../components/HoldingNewsPopover';
import TaxReport from '../components/TaxReport';
import AlertDialog from '../components/AlertDialog';
import SectionHeader from '../components/SectionHeader';
import { useFxRate } from '../hooks/useFxRate';
import { useIncome } from '../hooks/useIncome';
import { useUpdateAccount, useCreateAccount } from '../queries/accounts';
import type { Holding as ApiHolding, Account as ApiAccount } from '../types/api';

const fmtAudShort = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${v < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 100_000) return `${v < 0 ? '-' : ''}$${Math.round(abs / 1000)}k`;
  if (abs >= 1_000) return `${v < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`;
  return `${v < 0 ? '-' : ''}$${Math.round(abs).toLocaleString()}`;
};

interface RealEstate {
  id: number;
  name: string;
  value: number;
  location: string;
  type: 'realEstate';
  purchaseDate?: string;
  notes?: string;
}

interface Crypto {
  id: number;
  symbol: string;
  name: string;
  units: number;
  value: number;
  change: number;
  type: 'crypto';
  avgBuyPrice?: number;
  valueAud?: number;
  valueUsd?: number;
  costAud?: number;
  costUsd?: number;
  currentPrice?: number;
}

interface Vehicle {
  id: number;
  name: string;
  value: number;
  vehicleType: string;
  type: 'vehicle';
  year?: number;
}

interface Stock {
  id: number;
  symbol: string;
  name: string;
  units: number;
  value: number;
  weight: number;
  type: 'stock';
  avgBuyPrice?: number;
  valueAud?: number;
  valueUsd?: number;
  costAud?: number;
  costUsd?: number;
  currentPrice?: number;
  nativeCurrency?: string;
}

interface Cash {
  id: number;
  name: string;
  value: number;
  institution: string;
  type: 'cash';
  apy?: number;
  currency?: string;
}

type Holding = RealEstate | Crypto | Vehicle | Stock | Cash;

// Holdings, real estate, vehicles, and cash are all sourced from the API
// (tables: holdings + accounts). This array stays empty — legacy placeholder.
const initialHoldings: Holding[] = [];

const categoryColors: Record<string, string> = {
  realEstate: '#00E5FF',
  cash: '#78716c',
  crypto: '#44403c',
  vehicle: '#a8a29e',
  stock: '#1c1917',
};

const HeroTile = ({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) => (
  <div>
    <div className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">{label}</div>
    <div className={`text-3xl mt-1 tabular-nums ${accent || 'text-stone-900 dark:text-stone-50'}`}>{value}</div>
    {sub && <div className="text-xs text-stone-500 dark:text-stone-400 mt-1">{sub}</div>}
  </div>
);

const Portfolio = () => {
  const income = useIncome();
  const [holdings, setHoldings] = useState<Holding[]>(initialHoldings);
  const [apiHoldings, setApiHoldings] = useState<ApiHolding[]>([]);
  const [apiAccounts, setApiAccounts] = useState<ApiAccount[]>([]);
  const [_loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_activeTab, _setActiveTab] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [holdingType, setHoldingType] = useState<string>('stock');
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const { toasts, addToast, removeToast } = useToast();
  const usdAud = useFxRate('USD', 'AUD');
  const USD_TO_AUD = usdAud.rate;
  // Cash account mutations — go through React Query so a save invalidates
  // ['accounts'] + ['netWorth'] + ['runway'] in lockstep, refreshing the
  // header chip + Dashboard cockpit + any other consumer immediately.
  const updateAccount = useUpdateAccount();
  const createAccount = useCreateAccount();

  // Refetch both endpoints — used after every POST/PUT/DELETE so the UI stays in sync.
  const refetch = async () => {
    try {
      const [hRes, aRes] = await Promise.all([
        fetch('/api/holdings'),
        fetch('/api/accounts'),
      ]);
      if (hRes.ok) {
        const data = await hRes.json();
        setApiHoldings(Array.isArray(data) ? data : (data.holdings || []));
      }
      if (aRes.ok) {
        const data = await aRes.json();
        setApiAccounts(Array.isArray(data) ? data : (data.accounts || []));
      }
    } catch (err) {
      console.error('Portfolio refetch failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // All asset rows are sourced from the API. Holdings -> stocks/crypto/realEstate/vehicles,
  // Accounts -> cash. Ids below are DB ids (unique within each type's table).
  const mergedHoldings = useMemo(() => {
    const rows: Holding[] = [];

    apiHoldings.forEach((h) => {
      const nativeCurrency = (h as any).native_currency as string | undefined;
      const valueAud = (h as any).value_aud as number | undefined;
      const valueUsd = (h as any).value_usd as number | undefined;
      const costAud = (h as any).cost_aud as number | undefined;
      const costUsd = (h as any).cost_usd as number | undefined;
      const shares = h.shares ?? 0;
      const price = h.current_price ?? 0;
      const nativeValue = shares * price;

      if (h.asset_class === 'equity' || h.asset_class === 'etf') {
        rows.push({
          id: (h as any).id,
          symbol: h.symbol,
          name: h.asset_name || h.symbol,
          units: shares,
          value: nativeValue,
          weight: 0,
          type: 'stock',
          avgBuyPrice: h.cost_basis_per_share ?? undefined,
          currentPrice: h.current_price ?? undefined,
          valueAud, valueUsd, costAud, costUsd,
          nativeCurrency,
        } as Stock);
      } else if (h.asset_class === 'crypto') {
        rows.push({
          id: (h as any).id,
          symbol: h.symbol,
          name: h.asset_name || h.symbol,
          units: shares,
          value: nativeValue,
          change: 0,
          type: 'crypto',
          avgBuyPrice: h.cost_basis_per_share ?? undefined,
          currentPrice: h.current_price ?? undefined,
          valueAud, valueUsd, costAud, costUsd,
        } as Crypto);
      } else if (h.asset_class === 'alternative') {
        // Symbol prefix distinguishes real estate from vehicles.
        if (h.symbol.startsWith('REAL_ESTATE_')) {
          rows.push({
            id: (h as any).id,
            name: h.asset_name || h.symbol,
            value: valueAud ?? nativeValue,
            location: h.geography || '',
            type: 'realEstate',
          } as RealEstate);
        } else if (h.symbol.startsWith('VEHICLE_')) {
          rows.push({
            id: (h as any).id,
            name: h.asset_name || h.symbol,
            value: valueAud ?? nativeValue,
            vehicleType: h.sector || '',
            type: 'vehicle',
          } as Vehicle);
        }
      }
    });

    // Cash accounts (savings + checking only).
    apiAccounts.forEach((a) => {
      if (a.type !== 'savings' && a.type !== 'checking') return;
      rows.push({
        id: a.id,
        name: a.name,
        value: (a.current_balance_aud ?? a.current_balance ?? 0),
        institution: a.institution || '',
        type: 'cash',
        apy: a.apy ?? undefined,
        currency: a.currency ?? 'AUD',
      } as Cash);
    });

    // If API returned nothing yet, fall through to locally-set rows (empty initially).
    return rows.length > 0 ? rows : holdings;
  }, [holdings, apiHoldings, apiAccounts]);

  // Fetch live stock prices from API
  useEffect(() => {
    const fetchLivePrices = async () => {
      try {
        // Get stock symbols from holdings
        const stockSymbols = holdings
          .filter(h => h.type === 'stock')
          .map(h => (h as Stock).symbol);
        
        if (stockSymbols.length === 0) return;
        
        // Fetch from API for each symbol
        const priceMap: Record<string, number> = {};
        
        await Promise.all(
          stockSymbols.map(async (symbol) => {
            try {
              const response = await fetch(`/api/markets/US`);
              if (response.ok) {
                const data: { stocks?: { symbol: string; price: number }[] } = await response.json();
                const stockData = data.stocks?.find((s) => s.symbol === symbol);
                if (stockData?.price) {
                  priceMap[symbol] = stockData.price;
                }
              }
            } catch (err) {
              console.error(`Failed to fetch price for ${symbol}:`, err);
            }
          })
        );
        
        setLivePrices(priceMap);
      } catch (err) {
        console.error('Failed to fetch live prices:', err);
      }
    };
    
    fetchLivePrices();
    // Refresh every 5 minutes
    const interval = setInterval(fetchLivePrices, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [holdings]);

  // Update stock values based on live prices
  useEffect(() => {
    if (Object.keys(livePrices).length === 0) return;
    
    setHoldings(prev => prev.map(holding => {
      if (holding.type === 'stock') {
        const stock = holding as Stock;
        const livePrice = livePrices[stock.symbol];
        if (livePrice) {
          return {
            ...stock,
            value: stock.units * livePrice
          };
        }
      }
      return holding;
    }));
  }, [livePrices, setHoldings]);

  // Form states
  const [formData, setFormData] = useState<Record<string, any>>({});

  const realEstateHoldings = mergedHoldings.filter(h => h.type === 'realEstate') as RealEstate[];
  const cryptoHoldings = mergedHoldings.filter(h => h.type === 'crypto') as Crypto[];
  const vehicleHoldings = mergedHoldings.filter(h => h.type === 'vehicle') as Vehicle[];
  const stockHoldings = mergedHoldings.filter(h => h.type === 'stock') as Stock[];
  const cashHoldings = mergedHoldings.filter(h => h.type === 'cash') as Cash[];

  // FIX: previous version multiplied `h.value` (native currency) by USD_TO_AUD,
  // which double-counted FX for AUD-native stocks (VAS, CBA) and silently
  // inflated the Stocks bucket + total portfolio value.  Use valueAud directly
  // when the API provides it (always for crypto + stocks via _enrich_holding),
  // falling back to native × FX only if missing.
  const sumAud = <T extends { valueAud?: number; value: number }>(arr: T[], nativeCcy: 'USD' | 'AUD' = 'USD') =>
    arr.reduce((sum, h) => sum + (h.valueAud ?? (nativeCcy === 'AUD' ? h.value : h.value * USD_TO_AUD)), 0);

  const totals = {
    realEstate: realEstateHoldings.reduce((sum, h) => sum + h.value, 0),
    cash: cashHoldings.reduce((sum, h) => sum + h.value, 0),
    crypto: sumAud(cryptoHoldings),
    vehicle: vehicleHoldings.reduce((sum, h) => sum + h.value, 0),
    stock: sumAud(stockHoldings),
  };

  const totalValue = Object.values(totals).reduce((sum, val) => sum + val, 0);

  const categoryData = [
    { name: 'Real Estate', value: totals.realEstate, color: categoryColors.realEstate },
    { name: 'Cash', value: totals.cash, color: categoryColors.cash },
    { name: 'Crypto', value: totals.crypto, color: categoryColors.crypto },
    { name: 'Vehicles', value: totals.vehicle, color: categoryColors.vehicle },
    { name: 'Stocks', value: totals.stock, color: categoryColors.stock },
  ].filter(c => c.value > 0);

  const handleAdd = (type: string) => {
    setHoldingType(type);
    setEditingId(null);
    setFormData({});
    setShowModal(true);
  };

  const handleEdit = (holding: Holding) => {
    setHoldingType(holding.type);
    setEditingId(holding.id);
    setFormData({ ...holding });
    setShowModal(true);
  };

  // Find the current row (for its type) when acting on an edit/delete.
  const findRow = (id: number, type: string): Holding | undefined =>
    mergedHoldings.find(h => h.id === id && h.type === type);

  const handleDelete = async (id: number, type?: string) => {
    const row = type ? findRow(id, type) : mergedHoldings.find(h => h.id === id);
    if (!row) {
      console.warn('[handleDelete] no row found', { id, type, merged: mergedHoldings.length });
      addToast(`Row ${type}/${id} not found`, 'error');
      return;
    }
    const label = (row as any).name || (row as any).symbol;
    console.log('[handleDelete] start', { id, type, row });
    if (!confirm(`Delete "${label}"?`)) return;

    const isCash = row.type === 'cash';
    const baseUrl = isCash ? `/api/accounts/${id}` : `/api/holdings/${id}`;
    try {
      let res = await fetch(baseUrl, { method: 'DELETE' });
      console.log('[handleDelete] first response', res.status);
      if (res.status === 409 && !isCash) {
        const body = await res.json().catch(() => ({}));
        const msg = (body.detail as string) || 'This holding has linked transactions.';
        if (!confirm(`${msg}\n\nDelete "${label}" AND its transactions?`)) return;
        res = await fetch(`${baseUrl}?cascade=true`, { method: 'DELETE' });
        console.log('[handleDelete] cascade response', res.status);
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Delete failed (${res.status})`);
      }
      addToast('Deleted', 'success');
      await refetch();
    } catch (err) {
      console.error('[handleDelete] error', err);
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Parse numeric fields from the form.
    const num = (v: any) => (v === undefined || v === '' ? undefined : parseFloat(v));
    const valueNum = num(formData.value);
    const unitsNum = num(formData.units);
    const avgBuyPriceNum = num(formData.avgBuyPrice);
    const apyNum = num(formData.apy);

    try {
      if (holdingType === 'cash') {
        const body: Record<string, any> = {
          name: formData.name,
          type: 'savings',
          institution: formData.institution ?? null,
          currency: formData.currency || 'AUD',
          current_balance: valueNum ?? 0,
          apy: apyNum ?? null,
        };
        // Mutation auto-invalidates ['accounts'] + ['netWorth'] + ['runway']
        // on success — the header chip, Dashboard cockpit cash KPI, and any
        // future consumer using useAccounts() refetch in lockstep without
        // any manual coordination here.
        if (editingId) {
          await updateAccount.mutateAsync({ id: editingId, body });
        } else {
          await createAccount.mutateAsync({ body });
        }
        addToast(editingId ? 'Account updated — balances refreshing site-wide' : 'Account created', 'success');
      } else {
        // Holdings path — covers stock/crypto/realEstate/vehicle.
        const body: Record<string, any> = {};
        if (!editingId) body.kind = holdingType;
        if (formData.symbol) body.symbol = formData.symbol;
        if (formData.name) body.asset_name = formData.name;
        if (unitsNum !== undefined) body.shares = unitsNum;
        if (avgBuyPriceNum !== undefined) body.cost_basis_per_share = avgBuyPriceNum;
        if (valueNum !== undefined) {
          // For real estate / vehicles, shares=1 by convention → value == current_price.
          if (holdingType === 'realEstate' || holdingType === 'vehicle') {
            body.current_price = valueNum;
            if (body.shares === undefined) body.shares = 1;
            if (body.cost_basis_per_share === undefined && !editingId) {
              body.cost_basis_per_share = valueNum;
            }
          }
        }
        if (formData.location) body.geography = formData.location;
        if (formData.vehicleType) body.sector = formData.vehicleType;
        if (holdingType === 'realEstate' || holdingType === 'vehicle') {
          body.native_currency = body.native_currency || 'AUD';
          body.cost_basis_currency = body.cost_basis_currency || 'AUD';
        }

        const url = editingId ? `/api/holdings/${editingId}` : '/api/holdings';
        const method = editingId ? 'PUT' : 'POST';
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Save failed (${res.status})`);
        }
        addToast(editingId ? 'Holding updated' : 'Holding added', 'success');
      }

      setShowModal(false);
      await refetch();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    }
  };

  const renderFormFields = () => {
    switch (holdingType) {
      case 'stock':
        return (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Symbol *</label>
                <input
                  type="text"
                  value={formData.symbol || ''}
                  onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="NVDA"
                  required
                />
              </div>
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Company Name *</label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="NVIDIA"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Units *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.units || ''}
                  onChange={(e) => setFormData({ ...formData, units: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="10"
                  required
                />
              </div>
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Current Value (AUD) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.value || ''}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="2500"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Avg Buy Price (optional)</label>
              <input
                type="number"
                step="0.01"
                value={formData.avgBuyPrice || ''}
                onChange={(e) => setFormData({ ...formData, avgBuyPrice: e.target.value })}
                className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                placeholder="120"
              />
            </div>
          </>
        );

      case 'crypto':
        return (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Symbol *</label>
                <input
                  type="text"
                  value={formData.symbol || ''}
                  onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="BTC"
                  required
                />
              </div>
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="Bitcoin"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Units *</label>
                <input
                  type="number"
                  step="0.000001"
                  value={formData.units || ''}
                  onChange={(e) => setFormData({ ...formData, units: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="0.5"
                  required
                />
              </div>
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Current Value (AUD) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.value || ''}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="50000"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">24h Change %</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.change || ''}
                  onChange={(e) => setFormData({ ...formData, change: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="5.2"
                />
              </div>
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Avg Buy Price (optional)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.avgBuyPrice || ''}
                  onChange={(e) => setFormData({ ...formData, avgBuyPrice: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="45000"
                />
              </div>
            </div>
          </>
        );

      case 'realEstate':
        return (
          <>
            <div>
              <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Property Name *</label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                placeholder="Southport QLD Property"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Current Value (AUD) *</label>
                <input
                  type="number"
                  step="1000"
                  value={formData.value || ''}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="1000000"
                  required
                />
              </div>
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Location</label>
                <input
                  type="text"
                  value={formData.location || ''}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="Australia"
                />
              </div>
            </div>
            <div>
              <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Purchase Date</label>
              <input
                type="date"
                value={formData.purchaseDate || ''}
                onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
                className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
            <div>
              <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Notes</label>
              <textarea
                value={formData.notes || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                placeholder="Additional notes..."
                rows={3}
              />
            </div>
          </>
        );

      case 'vehicle':
        return (
          <>
            <div>
              <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Vehicle Name *</label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                placeholder="Land Rover 2023 Defender"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Current Value (AUD) *</label>
                <input
                  type="number"
                  step="100"
                  value={formData.value || ''}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="100000"
                  required
                />
              </div>
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Type</label>
                <input
                  type="text"
                  value={formData.vehicleType || ''}
                  onChange={(e) => setFormData({ ...formData, vehicleType: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="4WD"
                />
              </div>
            </div>
            <div>
              <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Year</label>
              <input
                type="number"
                value={formData.year || ''}
                onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                placeholder="2023"
              />
            </div>
          </>
        );

      case 'cash':
        return (
          <>
            <div>
              <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Account Name *</label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                placeholder="Rabobank PremiumSaver"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Balance (AUD) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.value || ''}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="100000"
                  required
                />
              </div>
              <div>
                <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">Institution</label>
                <input
                  type="text"
                  value={formData.institution || ''}
                  onChange={(e) => setFormData({ ...formData, institution: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="Rabobank"
                />
              </div>
            </div>
            <div>
              <label className="block text-base text-stone-700 dark:text-stone-200 mb-1">APY %</label>
              <input
                type="number"
                step="0.01"
                value={formData.apy || ''}
                onChange={(e) => setFormData({ ...formData, apy: e.target.value })}
                className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                placeholder="5.0"
              />
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <TaxReport />

      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl text-stone-900 dark:text-stone-50 flex items-center gap-3">
            <PieChartIcon className="w-6 h-6 text-stone-500 dark:text-stone-400" strokeWidth={1.75} />
            Portfolio
          </h1>
          <p className="text-base text-stone-500 dark:text-stone-400">
            Every asset you own — value, cost basis, and what it pays you each month.
          </p>
        </div>
      </div>

      {/* Income from assets hero — what this portfolio throws off every month */}
      <section>
        <SectionHeader icon={Wallet} label="Income from assets" />
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <HeroTile
              label="Total portfolio value"
              value={`$${Math.round(totalValue).toLocaleString()}`}
              sub={`${apiHoldings.length + apiAccounts.length} positions`}
            />
            <HeroTile
              label="Monthly income from assets"
              value={fmtAudShort(income.interest_monthly + income.staking_monthly)}
              sub={
                income.staking_monthly > 0
                  ? `interest ${fmtAudShort(income.interest_monthly)} · staking ${fmtAudShort(income.staking_monthly)} · ≈ ${(((income.interest_monthly + income.staking_monthly) * 12) / totalValue * 100).toFixed(2)}% blended yield`
                  : (income.interest_monthly > 0
                      ? `≈ ${((income.interest_monthly * 12) / totalValue * 100).toFixed(2)}% blended yield on total`
                      : 'no yielding assets')
              }
              accent="text-emerald-600 dark:text-emerald-400"
            />
            <HeroTile
              label="Missed income"
              value={income.opportunity_monthly_aud > 0 ? `+${fmtAudShort(income.opportunity_monthly_aud)}` : '—'}
              sub={income.opportunity_monthly_aud > 0 ? 'move idle cash to a 5.15%+ account' : 'all idle cash deployed'}
              accent={income.opportunity_monthly_aud > 0 ? 'text-cyan-600 dark:text-cyan-300' : undefined}
            />
          </div>
        </div>
      </section>

      {/* Allocation breakdown — neutral tiles, no coloured bg */}
      <section>
        <SectionHeader label="Allocation by asset class" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { type: 'realEstate', label: 'Real Estate', value: totals.realEstate, icon: Building2 },
            { type: 'cash',       label: 'Cash',        value: totals.cash,       icon: Wallet },
            { type: 'crypto',     label: 'Crypto',      value: totals.crypto,     icon: Bitcoin },
            { type: 'vehicle',    label: 'Vehicles',    value: totals.vehicle,    icon: Car },
            { type: 'stock',      label: 'Stocks',      value: totals.stock,      icon: LineChart },
          ].map(({ type, label, value, icon: Icon }) => (
            <div key={type} className="bg-white dark:bg-stone-900 rounded-2xl p-4 border border-stone-200 dark:border-stone-800">
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-4 h-4 text-stone-500 dark:text-stone-400" strokeWidth={1.75} />
                <span className="text-xs font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400">{label}</span>
              </div>
              <p className="text-2xl text-stone-900 dark:text-stone-50 tabular-nums">{fmtAudShort(value)}</p>
              <p className="text-xs text-stone-500 dark:text-stone-400 tabular-nums mt-1">
                {totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : 0}% of portfolio
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6">
          <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-4">Portfolio Allocation</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${percent ? (percent * 100).toFixed(0) : 0}%`}
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => typeof value === 'number' ? `$${value.toLocaleString()}` : value} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6">
          <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 mb-4">Holdings by Category</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value) => typeof value === 'number' ? `$${value.toLocaleString()}` : value} />
                <Bar dataKey="value" fill="#00E5FF" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Risk Analysis */}
      <RiskAnalysis />

      {/* Add Holding Buttons */}
      <div className="flex flex-wrap gap-2">
        <span className="text-base text-stone-600 dark:text-stone-300 self-center mr-2">Add Holding:</span>
        {[
          { type: 'stock', label: 'Stock', icon: LineChart },
          { type: 'crypto', label: 'Crypto', icon: Bitcoin },
          { type: 'realEstate', label: 'Property', icon: Home },
          { type: 'vehicle', label: 'Vehicle', icon: Car },
          { type: 'cash', label: 'Cash Account', icon: Wallet },
        ].map(({ type, label, icon: Icon }) => (
          <button
            key={type}
            onClick={() => handleAdd(type)}
            className="flex items-center gap-2 px-4 py-2 bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 rounded-lg hover:bg-stone-200 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Holdings Sections */}
      <div className="space-y-6">
        {/* Stocks */}
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 flex items-center gap-2 mb-3">
              <LineChart className="w-5 h-5 text-stone-500 dark:text-stone-400" />
              Stocks ({stockHoldings.length})
            </h3>
            <button onClick={() => handleAdd('stock')} className="text-base text-cyan-500 hover:text-cyan-600">
              + Add Stock
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-stone-200 dark:border-stone-800">
                  <th className="text-left py-2 text-base text-stone-500 dark:text-stone-400">Symbol</th>
                  <th className="text-left py-2 text-base text-stone-500 dark:text-stone-400">Name</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">Units</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">USD/Unit</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">AUD/Unit</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">USD Value</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">AUD Value</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stockHoldings.map((stock) => {
                  const valUsd = stock.valueUsd ?? (stock.nativeCurrency === 'AUD' ? stock.value / USD_TO_AUD : stock.value);
                  const valAud = stock.valueAud ?? (stock.nativeCurrency === 'AUD' ? stock.value : stock.value * USD_TO_AUD);
                  const unitUsd = stock.units > 0 ? valUsd / stock.units : 0;
                  const unitAud = stock.units > 0 ? valAud / stock.units : 0;
                  return (
                    <tr key={stock.id} className="border-b border-stone-100 dark:border-stone-800">
                      <td className="py-3 text-stone-800 dark:text-stone-100">{stock.symbol}</td>
                      <td className="py-3 text-stone-600 dark:text-stone-400">{stock.name}</td>
                      <td className="py-3 text-right text-stone-600 dark:text-stone-400">{stock.units}</td>
                      <td className="py-3 text-right text-stone-500 dark:text-stone-400">${unitUsd.toFixed(2)}</td>
                      <td className="py-3 text-right text-stone-500 dark:text-stone-400">${unitAud.toFixed(2)}</td>
                      <td className="py-3 text-right text-stone-600 dark:text-stone-400">${Math.round(valUsd).toLocaleString()}</td>
                      <td className="py-3 text-right text-stone-800 dark:text-stone-100">${Math.round(valAud).toLocaleString()}</td>
                      <td className="py-3 text-right">
                        <span className="inline-flex items-center">
                          <HoldingNewsPopover symbol={stock.symbol} assetName={stock.name} />
                          <AlertDialog symbol={stock.symbol} assetName={stock.name} addToast={addToast} />
                          <button onClick={() => handleEdit(stock)} className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded mr-1" aria-label="Edit holding">
                            <Edit2 className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                          </button>
                          <button onClick={() => handleDelete(stock.id, "stock")} className="p-1 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded" aria-label="Delete holding">
                            <Trash2 className="w-4 h-4 text-stone-400 dark:text-stone-500 hover:text-rose-500" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-stone-300 dark:border-stone-700 font-semibold">
                  <td className="py-3 text-stone-800 dark:text-stone-100" colSpan={5}>Total</td>
                  <td className="py-3 text-right text-stone-800 dark:text-stone-100">${Math.round(stockHoldings.reduce((s, h) => s + (h.valueUsd ?? (h.nativeCurrency === 'AUD' ? h.value / USD_TO_AUD : h.value)), 0)).toLocaleString()}</td>
                  <td className="py-3 text-right text-stone-800 dark:text-stone-100">${Math.round(stockHoldings.reduce((s, h) => s + (h.valueAud ?? (h.nativeCurrency === 'AUD' ? h.value : h.value * USD_TO_AUD)), 0)).toLocaleString()}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Crypto */}
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 flex items-center gap-2 mb-3">
              <Bitcoin className="w-5 h-5 text-stone-500 dark:text-stone-400" />
              Cryptocurrency ({cryptoHoldings.length})
            </h3>
            <button onClick={() => handleAdd('crypto')} className="text-base text-cyan-500 hover:text-cyan-600">
              + Add Crypto
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-stone-200 dark:border-stone-800">
                  <th className="text-left py-2 text-base text-stone-500 dark:text-stone-400">Asset</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">Units</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">USD/Unit</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">AUD/Unit</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">USD Value</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">AUD Value</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">24h</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cryptoHoldings.map((coin) => {
                  const valUsd = coin.valueUsd ?? coin.value;
                  const valAud = coin.valueAud ?? coin.value * USD_TO_AUD;
                  const unitUsd = coin.units > 0 ? valUsd / coin.units : 0;
                  const unitAud = coin.units > 0 ? valAud / coin.units : 0;
                  return (
                    <tr key={coin.id} className="border-b border-stone-100 dark:border-stone-800">
                      <td className="py-3">
                        <div>
                          <p className="text-stone-800 dark:text-stone-100">{coin.name}</p>
                          <p className="text-xs text-stone-500 dark:text-stone-400">{coin.symbol}</p>
                        </div>
                      </td>
                      <td className="py-3 text-right text-stone-600 dark:text-stone-300">{coin.units}</td>
                      <td className="py-3 text-right text-stone-500 dark:text-stone-400">${unitUsd.toFixed(2)}</td>
                      <td className="py-3 text-right text-stone-500 dark:text-stone-400">${unitAud.toFixed(2)}</td>
                      <td className="py-3 text-right text-stone-600 dark:text-stone-400">${Math.round(valUsd).toLocaleString()}</td>
                      <td className="py-3 text-right text-stone-800 dark:text-stone-100">${Math.round(valAud).toLocaleString()}</td>
                      <td className="py-3 text-right">
                        <span className={`flex items-center justify-end gap-1 text-base ${(coin.change || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {(coin.change || 0) >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                          {Math.abs(coin.change || 0).toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span className="inline-flex items-center">
                          <HoldingNewsPopover symbol={coin.symbol} assetName={coin.name} />
                          <AlertDialog symbol={coin.symbol} assetName={coin.name} addToast={addToast} />
                          <button onClick={() => handleEdit(coin)} className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded mr-1" aria-label="Edit holding">
                            <Edit2 className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                          </button>
                          <button onClick={() => handleDelete(coin.id, "crypto")} className="p-1 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded" aria-label="Delete holding">
                            <Trash2 className="w-4 h-4 text-stone-400 dark:text-stone-500 hover:text-rose-500" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-stone-300 dark:border-stone-700 font-semibold">
                  <td className="py-3 text-stone-800 dark:text-stone-100" colSpan={4}>Total</td>
                  <td className="py-3 text-right text-stone-800 dark:text-stone-100">${Math.round(cryptoHoldings.reduce((s, h) => s + (h.valueUsd ?? h.value), 0)).toLocaleString()}</td>
                  <td className="py-3 text-right text-stone-800 dark:text-stone-100">${Math.round(cryptoHoldings.reduce((s, h) => s + (h.valueAud ?? h.value * USD_TO_AUD), 0)).toLocaleString()}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Real Estate */}
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 flex items-center gap-2 mb-3">
              <Building2 className="w-5 h-5 text-cyan-500" />
              Real Estate ({realEstateHoldings.length})
            </h3>
            <button onClick={() => handleAdd('realEstate')} className="text-base text-cyan-500 hover:text-cyan-600">
              + Add Property
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-stone-200 dark:border-stone-800">
                  <th className="text-left py-2 text-base text-stone-500 dark:text-stone-400">Property</th>
                  <th className="text-left py-2 text-base text-stone-500 dark:text-stone-400">Location</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">Purchased</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">Value</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">% of RE</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {realEstateHoldings.map((property) => {
                  const reTotal = realEstateHoldings.reduce((sum, h) => sum + h.value, 0);
                  const percent = reTotal > 0 ? ((property.value / reTotal) * 100).toFixed(1) : '0';
                  return (
                    <tr key={property.id} className="border-b border-stone-100 dark:border-stone-800">
                      <td className="py-3">
                        <p className="text-stone-800 dark:text-stone-100">{property.name}</p>
                      </td>
                      <td className="py-3 text-stone-600 dark:text-stone-400">{property.location}</td>
                      <td className="py-3 text-right text-stone-500 dark:text-stone-400">{property.purchaseDate || '-'}</td>
                      <td className="py-3 text-right text-stone-800 dark:text-stone-100">${Math.round(property.value).toLocaleString()}</td>
                      <td className="py-3 text-right text-stone-500 dark:text-stone-400">{percent}%</td>
                      <td className="py-3 text-right">
                        <button onClick={() => handleEdit(property)} className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded mr-1" aria-label="Edit holding">
                          <Edit2 className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                        </button>
                        <button onClick={() => handleDelete(property.id, "realEstate")} className="p-1 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded" aria-label="Delete holding">
                          <Trash2 className="w-4 h-4 text-stone-400 dark:text-stone-500 hover:text-rose-500" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-stone-300 dark:border-stone-700 font-semibold">
                  <td className="py-3 text-stone-800 dark:text-stone-100" colSpan={3}>Total</td>
                  <td className="py-3 text-right text-stone-800 dark:text-stone-100">${Math.round(realEstateHoldings.reduce((s, h) => s + h.value, 0)).toLocaleString()}</td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Vehicles */}
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 flex items-center gap-2 mb-3">
              <Car className="w-5 h-5 text-stone-700 dark:text-stone-300" />
              Vehicles ({vehicleHoldings.length})
            </h3>
            <button onClick={() => handleAdd('vehicle')} className="text-base text-cyan-500 hover:text-cyan-600">
              + Add Vehicle
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-stone-200 dark:border-stone-800">
                  <th className="text-left py-2 text-base text-stone-500 dark:text-stone-400">Vehicle</th>
                  <th className="text-left py-2 text-base text-stone-500 dark:text-stone-400">Type</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">Year</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">Value</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">% of Vehicles</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vehicleHoldings.map((vehicle) => {
                  const vehicleTotal = vehicleHoldings.reduce((sum, h) => sum + h.value, 0);
                  const percent = vehicleTotal > 0 ? ((vehicle.value / vehicleTotal) * 100).toFixed(1) : '0';
                  return (
                    <tr key={vehicle.id} className="border-b border-stone-100 dark:border-stone-800">
                      <td className="py-3">
                        <p className="text-stone-800 dark:text-stone-100">{vehicle.name}</p>
                      </td>
                      <td className="py-3 text-stone-600 dark:text-stone-400">{vehicle.vehicleType}</td>
                      <td className="py-3 text-right text-stone-500 dark:text-stone-400">{vehicle.year || '-'}</td>
                      <td className="py-3 text-right text-stone-800 dark:text-stone-100">${Math.round(vehicle.value).toLocaleString()}</td>
                      <td className="py-3 text-right text-stone-500 dark:text-stone-400">{percent}%</td>
                      <td className="py-3 text-right">
                        <button onClick={() => handleEdit(vehicle)} className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded mr-1" aria-label="Edit holding">
                          <Edit2 className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                        </button>
                        <button onClick={() => handleDelete(vehicle.id, "vehicle")} className="p-1 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded" aria-label="Delete holding">
                          <Trash2 className="w-4 h-4 text-stone-400 dark:text-stone-500 hover:text-rose-500" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-stone-300 dark:border-stone-700 font-semibold">
                  <td className="py-3 text-stone-800 dark:text-stone-100" colSpan={3}>Total</td>
                  <td className="py-3 text-right text-stone-800 dark:text-stone-100">${Math.round(vehicleHoldings.reduce((s, h) => s + h.value, 0)).toLocaleString()}</td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Cash */}
        <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400 flex items-center gap-2 mb-3">
              <Wallet className="w-5 h-5 text-stone-500 dark:text-stone-400" />
              Cash Accounts ({cashHoldings.length})
            </h3>
            <button onClick={() => handleAdd('cash')} className="text-base text-cyan-500 hover:text-cyan-600">
              + Add Account
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-stone-200 dark:border-stone-800">
                  <th className="text-left py-2 text-base text-stone-500 dark:text-stone-400">Account</th>
                  <th className="text-left py-2 text-base text-stone-500 dark:text-stone-400">Institution</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">Currency</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">APY</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">Value (AUD)</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">Monthly Interest</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">% of Cash</th>
                  <th className="text-right py-2 text-base text-stone-500 dark:text-stone-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cashHoldings.map((account) => {
                  const cashTotal = cashHoldings.reduce((sum, h) => sum + h.value, 0);
                  const percent = cashTotal > 0 ? ((account.value / cashTotal) * 100).toFixed(1) : '0';
                  const cash = account as Cash;
                  const monthlyInterest = account.apy ? (account.value * (account.apy / 100) / 12) : 0;
                  return (
                    <tr key={account.id} className="border-b border-stone-100 dark:border-stone-800">
                      <td className="py-3">
                        <p className="text-stone-800 dark:text-stone-100">{account.name}</p>
                      </td>
                      <td className="py-3 text-stone-600 dark:text-stone-400">{account.institution}</td>
                      <td className="py-3 text-right text-stone-500 dark:text-stone-400">{cash.currency || 'AUD'}</td>
                      <td className="py-3 text-right text-stone-500 dark:text-stone-400">{account.apy !== undefined ? `${account.apy}%` : '-'}</td>
                      <td className="py-3 text-right text-stone-800 dark:text-stone-100">${Math.round(account.value).toLocaleString()}</td>
                      <td className="py-3 text-right text-emerald-600 dark:text-emerald-400 ">${Math.round(monthlyInterest).toLocaleString()}</td>
                      <td className="py-3 text-right text-stone-500 dark:text-stone-400">{percent}%</td>
                      <td className="py-3 text-right">
                        <button onClick={() => handleEdit(account)} className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded mr-1" aria-label="Edit holding">
                          <Edit2 className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                        </button>
                        <button onClick={() => handleDelete(account.id, "cash")} className="p-1 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded" aria-label="Delete holding">
                          <Trash2 className="w-4 h-4 text-stone-400 dark:text-stone-500 hover:text-rose-500" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-stone-300 dark:border-stone-700 font-semibold">
                  <td className="py-3 text-stone-800 dark:text-stone-100" colSpan={4}>Total</td>
                  <td className="py-3 text-right text-stone-800 dark:text-stone-100">${Math.round(cashHoldings.reduce((s, h) => s + h.value, 0)).toLocaleString()}</td>
                  <td className="py-3 text-right text-emerald-600 dark:text-emerald-400">${Math.round(cashHoldings.reduce((s, h) => s + ((h.apy ? h.value * (h.apy / 100) / 12 : 0)), 0)).toLocaleString()}</td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-stone-900 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" role="dialog" aria-label={editingId ? 'Edit holding' : 'Add holding'}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">
                {editingId ? 'Edit' : 'Add'} {holdingType === 'realEstate' ? 'Property' : holdingType === 'vehicle' ? 'Vehicle' : holdingType === 'cash' ? 'Cash Account' : holdingType}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg" aria-label="Close">
                <X className="w-5 h-5 text-stone-400 dark:text-stone-500" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {renderFormFields()}
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors"
                >
                  {editingId ? 'Save Changes' : 'Add Holding'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Portfolio;
