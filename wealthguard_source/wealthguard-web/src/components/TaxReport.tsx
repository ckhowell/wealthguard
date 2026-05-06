import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Scale, Loader2 } from 'lucide-react';
import ErrorState from './ErrorState';

interface RealizedLot {
  txn_id: number;
  symbol: string;
  sold_on: string;
  shares: number;
  cost_per_share: number;
  proceeds_per_share: number;
  cost_basis: number;
  proceeds: number;
  gain: number;
  lot_id?: number;
  note?: string;
}

interface UnrealizedLot {
  lot_id: number;
  symbol: string;
  purchase_date: string;
  shares: number;
  cost_per_share: number;
  current_price: number;
  cost_basis: number;
  market_value: number;
  gain: number;
  holding_period_days: number;
}

interface TaxResponse {
  year: number;
  fy: 'calendar' | 'au';
  fy_start: string;
  fy_end: string;
  realized: RealizedLot[];
  unrealized: UnrealizedLot[];
  total_realized: number;
  total_unrealized: number;
  note?: string;
}

const formatAud = (v: number) =>
  v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 });

function downloadCsv(filename: string, rows: string[][]) {
  const escaped = rows.map((r) =>
    r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')
  ).join('\n');
  const blob = new Blob([escaped], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const TaxReport = () => {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [fy, setFy] = useState<'calendar' | 'au'>('calendar');
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TaxResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ year: String(year), fy });
      const res = await fetch(`/api/tax/report?${qs}`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tax report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, year, fy]);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const exportAll = () => {
    if (!data) return;
    const rows: string[][] = [];
    rows.push(['Section', 'Symbol', 'Date', 'Shares', 'Cost/Share', 'Price/Share', 'Cost Basis', 'Market/Proceeds', 'Gain']);
    for (const r of data.realized) {
      rows.push([
        'realized', r.symbol, r.sold_on,
        String(r.shares), String(r.cost_per_share), String(r.proceeds_per_share),
        String(r.cost_basis), String(r.proceeds), String(r.gain),
      ]);
    }
    for (const u of data.unrealized) {
      rows.push([
        'unrealized', u.symbol, u.purchase_date,
        String(u.shares), String(u.cost_per_share), String(u.current_price),
        String(u.cost_basis), String(u.market_value), String(u.gain),
      ]);
    }
    downloadCsv(`tax-${data.year}-${data.fy}.csv`, rows);
  };

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl shadow-sm border border-stone-200 dark:border-stone-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 sm:p-6 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          {open ? (
            <ChevronDown className="w-5 h-5 text-stone-400 dark:text-stone-500" />
          ) : (
            <ChevronRight className="w-5 h-5 text-stone-400 dark:text-stone-500" />
          )}
          <Scale className="w-5 h-5 text-cyan-500" />
          <div>
            <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">Tax report</h3>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Realized + unrealized gains by lot. Not tax advice.
            </p>
          </div>
        </div>
        {data && open && (
          <div className="hidden sm:flex gap-4 text-base">
            <span>
              <span className="text-stone-500 dark:text-stone-400">Realized</span>{' '}
              <span className={`font-semibold ${data.total_realized >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {formatAud(data.total_realized)}
              </span>
            </span>
            <span>
              <span className="text-stone-500 dark:text-stone-400">Unrealized</span>{' '}
              <span className={`font-semibold ${data.total_unrealized >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {formatAud(data.total_unrealized)}
              </span>
            </span>
          </div>
        )}
      </button>

      {open && (
        <div className="px-4 sm:px-6 pb-6 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="text-base border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 rounded-lg px-2 py-1"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <div className="inline-flex p-1 rounded-lg bg-stone-100 dark:bg-stone-800">
              <button
                type="button"
                onClick={() => setFy('calendar')}
                className={`px-2.5 py-1 text-xs rounded-md ${
                  fy === 'calendar'
                    ? 'bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 shadow-sm'
                    : 'text-stone-600 dark:text-stone-300'
                }`}
              >
                Calendar year
              </button>
              <button
                type="button"
                onClick={() => setFy('au')}
                className={`px-2.5 py-1 text-xs rounded-md ${
                  fy === 'au'
                    ? 'bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 shadow-sm'
                    : 'text-stone-600 dark:text-stone-300'
                }`}
              >
                AU FY
              </button>
            </div>
            <button
              type="button"
              onClick={exportAll}
              disabled={!data}
              className="ml-auto flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-700 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          </div>

          {error && <ErrorState title="Couldn't load tax report" message={error} onRetry={load} />}

          {loading && !data ? (
            <div className="flex items-center gap-2 text-base text-stone-500 dark:text-stone-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : data ? (
            <>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {data.fy_start} → {data.fy_end}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-800">
                  <p className="text-base text-stone-500 dark:text-stone-400">Realized gain</p>
                  <p
                    className={`text-2xl font-bold mt-1 ${
                      data.total_realized >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {formatAud(data.total_realized)}
                  </p>
                  <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                    {data.realized.length} sell event{data.realized.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-800">
                  <p className="text-base text-stone-500 dark:text-stone-400">Unrealized gain</p>
                  <p
                    className={`text-2xl font-bold mt-1 ${
                      data.total_unrealized >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {formatAud(data.total_unrealized)}
                  </p>
                  <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                    {data.unrealized.length} open lot{data.unrealized.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>

              {data.note && (
                <p className="text-xs text-cyan-600 dark:text-cyan-300">{data.note}</p>
              )}

              {data.unrealized.length > 0 && (
                <section>
                  <h4 className="text-base font-semibold text-stone-700 dark:text-stone-200 mb-2">
                    Unrealized lots
                  </h4>
                  <div className="overflow-x-auto border border-stone-200 dark:border-stone-800 rounded-lg">
                    <table className="min-w-full text-base">
                      <thead className="bg-stone-50 dark:bg-stone-800">
                        <tr>
                          <th className="px-3 py-2 text-left text-stone-500 dark:text-stone-400">Symbol</th>
                          <th className="px-3 py-2 text-left text-stone-500 dark:text-stone-400">Purchased</th>
                          <th className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">Shares</th>
                          <th className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">Cost/Share</th>
                          <th className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">Current</th>
                          <th className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">Market value</th>
                          <th className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">Gain</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.unrealized.map((u) => (
                          <tr key={u.lot_id} className="border-t border-stone-100 dark:border-stone-800">
                            <td className="px-3 py-2 text-stone-800 dark:text-stone-100">{u.symbol}</td>
                            <td className="px-3 py-2 text-stone-600 dark:text-stone-300">{u.purchase_date}</td>
                            <td className="px-3 py-2 text-right text-stone-600 dark:text-stone-300">{u.shares}</td>
                            <td className="px-3 py-2 text-right text-stone-600 dark:text-stone-300">{formatAud(u.cost_per_share)}</td>
                            <td className="px-3 py-2 text-right text-stone-600 dark:text-stone-300">{formatAud(u.current_price)}</td>
                            <td className="px-3 py-2 text-right text-stone-700 dark:text-stone-200">{formatAud(u.market_value)}</td>
                            <td className={`px-3 py-2 text-right font-semibold ${u.gain >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              {formatAud(u.gain)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {data.realized.length > 0 && (
                <section>
                  <h4 className="text-base font-semibold text-stone-700 dark:text-stone-200 mb-2">
                    Realized lots ({data.fy_start} → {data.fy_end})
                  </h4>
                  <div className="overflow-x-auto border border-stone-200 dark:border-stone-800 rounded-lg">
                    <table className="min-w-full text-base">
                      <thead className="bg-stone-50 dark:bg-stone-800">
                        <tr>
                          <th className="px-3 py-2 text-left text-stone-500 dark:text-stone-400">Symbol</th>
                          <th className="px-3 py-2 text-left text-stone-500 dark:text-stone-400">Sold</th>
                          <th className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">Shares</th>
                          <th className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">Cost basis</th>
                          <th className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">Proceeds</th>
                          <th className="px-3 py-2 text-right text-stone-500 dark:text-stone-400">Gain</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.realized.map((r) => (
                          <tr key={r.txn_id} className="border-t border-stone-100 dark:border-stone-800">
                            <td className="px-3 py-2 text-stone-800 dark:text-stone-100">{r.symbol}</td>
                            <td className="px-3 py-2 text-stone-600 dark:text-stone-300">{r.sold_on}</td>
                            <td className="px-3 py-2 text-right text-stone-600 dark:text-stone-300">{r.shares}</td>
                            <td className="px-3 py-2 text-right text-stone-600 dark:text-stone-300">{formatAud(r.cost_basis)}</td>
                            <td className="px-3 py-2 text-right text-stone-700 dark:text-stone-200">{formatAud(r.proceeds)}</td>
                            <td className={`px-3 py-2 text-right font-semibold ${r.gain >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              {formatAud(r.gain)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default TaxReport;
