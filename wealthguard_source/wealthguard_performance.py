#!/usr/bin/env python3
"""
WealthGuard portfolio performance.

Computes TWR (time-weighted return), IRR (money-weighted via Newton-Raphson),
max drawdown, annualised volatility, and pulls benchmark price series from
yfinance (falling back to an empty series on failure). Designed to handle
sparse snapshot history gracefully — callers should always check
`len(series) >= 2` before rendering.

All figures are AUD. Time-series dates are ISO `YYYY-MM-DD`.
"""
from __future__ import annotations

import os
import math
import sqlite3
import logging
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger('wealthguard.performance')

DB_PATH = os.getenv('DATABASE_PATH', '/root/.openclaw/workspace/wealthguard.db')

PERIOD_DAYS = {
    'MTD': None,      # computed as days since start of month
    'YTD': None,      # since start of year
    '1M': 30,
    '3M': 90,
    '6M': 180,
    '1Y': 365,
    '3Y': 365 * 3,
    'ALL': None,      # no filter
}


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _period_start(period: str, latest: date) -> Optional[date]:
    period = period.upper()
    if period == 'MTD':
        return date(latest.year, latest.month, 1)
    if period == 'YTD':
        return date(latest.year, 1, 1)
    if period == 'ALL':
        return None
    days = PERIOD_DAYS.get(period)
    if days is None:
        return None
    return latest - timedelta(days=days)


def _load_nw_series(start: Optional[date]) -> List[Tuple[date, float]]:
    with _get_conn() as conn:
        if start is None:
            rows = conn.execute(
                "SELECT snapshot_date, net_worth FROM net_worth_history ORDER BY snapshot_date ASC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT snapshot_date, net_worth FROM net_worth_history "
                "WHERE snapshot_date >= ? ORDER BY snapshot_date ASC",
                (start.isoformat(),),
            ).fetchall()
    # Collapse duplicate snapshots on the same date (pick the largest net_worth,
    # which is typically the most complete). The current DB has dup 2026-03-30 rows.
    bucket: Dict[str, float] = {}
    for r in rows:
        d = r['snapshot_date']
        v = float(r['net_worth'] or 0)
        if d not in bucket or v > bucket[d]:
            bucket[d] = v
    return [(date.fromisoformat(d), v) for d, v in sorted(bucket.items())]


def _load_cash_flows(start: Optional[date]) -> List[Tuple[date, float]]:
    """External contributions/withdrawals via transactions. Positive = deposit."""
    with _get_conn() as conn:
        where = ""
        params: tuple = ()
        if start is not None:
            where = "WHERE transaction_date >= ?"
            params = (start.isoformat(),)
        rows = conn.execute(
            f"""
            SELECT transaction_date,
                   SUM(CASE WHEN transaction_type = 'credit' THEN amount
                            WHEN transaction_type = 'debit'  THEN -amount
                            ELSE 0 END) AS net
            FROM transactions
            {where}
            GROUP BY transaction_date
            """,
            params,
        ).fetchall()
    return [(date.fromisoformat(r['transaction_date']), float(r['net'] or 0)) for r in rows]


def compute_twr(series: List[Tuple[date, float]], cash_flows: List[Tuple[date, float]]) -> Optional[float]:
    """Modified-Dietz-style TWR. Chain sub-period returns between snapshots."""
    if len(series) < 2:
        return None
    flows_by_day: Dict[date, float] = {}
    for d, f in cash_flows:
        flows_by_day[d] = flows_by_day.get(d, 0) + f
    product = 1.0
    for i in range(1, len(series)):
        d0, v0 = series[i - 1]
        d1, v1 = series[i]
        # Cash flow inside the sub-period (exclusive of d0, inclusive of d1).
        cf = 0.0
        cur = d0 + timedelta(days=1)
        while cur <= d1:
            cf += flows_by_day.get(cur, 0)
            cur += timedelta(days=1)
        denom = v0 + 0.5 * cf
        if denom <= 0:
            continue
        r = (v1 - v0 - cf) / denom
        product *= (1 + r)
    return product - 1


def _npv(rate: float, flows: List[Tuple[date, float]], base: date) -> float:
    total = 0.0
    for d, f in flows:
        t = (d - base).days / 365.0
        total += f / ((1 + rate) ** t)
    return total


def compute_irr(cash_flows: List[Tuple[date, float]], final_value: float, final_date: date,
                initial_value: float, initial_date: date) -> Optional[float]:
    """Money-weighted return. Initial value is a cash outflow, cash flows are
    signed deposits/withdrawals, final value is a terminal inflow."""
    flows: List[Tuple[date, float]] = []
    if initial_value > 0:
        flows.append((initial_date, -initial_value))
    # Treat deposits as outflows (negative) and withdrawals as inflows.
    for d, f in cash_flows:
        if f != 0:
            flows.append((d, -f))
    flows.append((final_date, final_value))
    if len(flows) < 2:
        return None

    rate = 0.10
    for _ in range(80):
        try:
            npv = _npv(rate, flows, initial_date)
            # Numerical derivative
            dnpv = (_npv(rate + 1e-6, flows, initial_date) - npv) / 1e-6
            if abs(dnpv) < 1e-12:
                break
            new_rate = rate - npv / dnpv
            if new_rate <= -0.99:
                new_rate = -0.99
            if abs(new_rate - rate) < 1e-7:
                rate = new_rate
                break
            rate = new_rate
        except (OverflowError, ZeroDivisionError):
            return None
    if not math.isfinite(rate):
        return None
    return rate


def compute_drawdown(series: List[Tuple[date, float]]) -> Optional[float]:
    if not series:
        return None
    peak = float('-inf')
    max_dd = 0.0
    for _, v in series:
        if v > peak:
            peak = v
        if peak > 0:
            dd = (v - peak) / peak
            if dd < max_dd:
                max_dd = dd
    return max_dd


def compute_volatility(series: List[Tuple[date, float]]) -> Optional[float]:
    """Annualised stdev of daily log returns. Assumes daily snapshots."""
    if len(series) < 3:
        return None
    returns: List[float] = []
    for i in range(1, len(series)):
        v0 = series[i - 1][1]
        v1 = series[i][1]
        if v0 <= 0 or v1 <= 0:
            continue
        returns.append(math.log(v1 / v0))
    if len(returns) < 2:
        return None
    mean = sum(returns) / len(returns)
    var = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
    return math.sqrt(var) * math.sqrt(252)


def benchmark_series(symbol: str, start: date, end: date) -> List[Tuple[date, float]]:
    """Fetch daily close prices for a benchmark symbol. yfinance first; empty on error."""
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        hist = ticker.history(
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),
            auto_adjust=True,
        )
        if hist is None or hist.empty:
            return []
        series: List[Tuple[date, float]] = []
        for idx, row in hist.iterrows():
            try:
                d = idx.date() if hasattr(idx, 'date') else idx
                series.append((d, float(row['Close'])))
            except (KeyError, ValueError, TypeError):
                continue
        return series
    except ImportError:
        logger.info("yfinance not installed; benchmark series unavailable")
        return []
    except Exception as e:
        logger.warning(f"Benchmark fetch failed for {symbol}: {e}")
        return []


def _rebase_to_100(series: List[Tuple[date, float]]) -> List[Dict]:
    if not series:
        return []
    base = series[0][1]
    if base <= 0:
        return []
    return [{'date': d.isoformat(), 'value': round((v / base) * 100, 3)} for d, v in series]


def compute_performance(period: str = '1Y', benchmark: Optional[str] = None) -> Dict:
    series = _load_nw_series(None)
    if not series:
        return {
            'period': period,
            'twr': None,
            'irr': None,
            'max_drawdown': None,
            'volatility': None,
            'series': [],
            'benchmark_series': [],
            'benchmark_symbol': benchmark,
            'note': 'No net worth snapshots yet — sync once per day to populate history.',
        }
    latest_date = series[-1][0]
    start = _period_start(period, latest_date)
    windowed = [pt for pt in series if start is None or pt[0] >= start]
    if len(windowed) < 2:
        # fall back to full series so the UI has something to render
        windowed = series

    cash_flows = _load_cash_flows(windowed[0][0])
    twr = compute_twr(windowed, cash_flows)
    irr = compute_irr(
        cash_flows,
        final_value=windowed[-1][1],
        final_date=windowed[-1][0],
        initial_value=windowed[0][1],
        initial_date=windowed[0][0],
    )
    drawdown = compute_drawdown(windowed)
    vol = compute_volatility(windowed)

    bench: List[Tuple[date, float]] = []
    if benchmark:
        bench = benchmark_series(benchmark, windowed[0][0], windowed[-1][0])

    return {
        'period': period,
        'start_date': windowed[0][0].isoformat(),
        'end_date': windowed[-1][0].isoformat(),
        'snapshots': len(windowed),
        'start_value': round(windowed[0][1], 2),
        'end_value': round(windowed[-1][1], 2),
        'twr': None if twr is None else round(twr, 6),
        'irr': None if irr is None else round(irr, 6),
        'max_drawdown': None if drawdown is None else round(drawdown, 6),
        'volatility': None if vol is None else round(vol, 6),
        'series': _rebase_to_100(windowed),
        'benchmark_series': _rebase_to_100(bench),
        'benchmark_symbol': benchmark,
    }


if __name__ == '__main__':
    import json
    import sys
    period = sys.argv[1] if len(sys.argv) > 1 else '1Y'
    benchmark = sys.argv[2] if len(sys.argv) > 2 else None
    print(json.dumps(compute_performance(period, benchmark), indent=2))
