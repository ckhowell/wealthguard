#!/usr/bin/env python3
"""
Reconstruct crypto cost basis from Binance + Swyftx CSV exports.

Strategy (no CGT math — user isn't selling until post-2030):
  - Sum AUD spent acquiring each symbol (BUYs + staking REWARDs at AUD value).
  - Sum quantity acquired.
  - weighted_avg_aud_cost = total_aud_spent / total_qty_acquired.

Trust existing `holdings.shares` — overwrite only `cost_basis_per_share`.

Usage:
    python3 crypto_cost_basis.py              # dry run, prints table
    python3 crypto_cost_basis.py --apply      # write to DB
"""
from __future__ import annotations

import csv
import os
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
BINANCE_CSV = HERE / "binance_history.csv"
SWYFTX_CSV = HERE / "swyftx_history.csv"
IR_CSV = HERE / "ir_orders.csv"
DB_PATH = os.getenv("DATABASE_PATH", str(HERE / "wealthguard.db"))

SYMBOL_ALIASES = {
    # Binance uses these tickers; map to what holdings table uses.
    "LUNC": "LUNC",
    "LUNA": "LUNA",
}


def parse_binance(path: Path) -> dict[str, dict]:
    """Group Binance rows by timestamp to pair AUD↔coin trades."""
    by_symbol = defaultdict(lambda: {"aud_spent": 0.0, "qty": 0.0, "rewards_aud": 0.0, "rewards_qty": 0.0})
    # Bucket rows by timestamp to find AUD↔coin pairs.
    buckets: dict[str, list[dict]] = defaultdict(list)
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            buckets[row["Time"]].append(row)

    for ts, rows in buckets.items():
        # Trade pair: exactly one AUD leg and one coin leg, both Transaction Related.
        trade_rows = [r for r in rows if r["Operation"] == "Transaction Related"]
        aud_legs = [r for r in trade_rows if r["Coin"] == "AUD"]
        coin_legs = [r for r in trade_rows if r["Coin"] != "AUD"]
        if len(aud_legs) == 1 and len(coin_legs) == 1:
            aud = aud_legs[0]
            coin = coin_legs[0]
            aud_delta = float(aud["Change"])
            coin_delta = float(coin["Change"])
            sym = coin["Coin"]
            if aud_delta < 0 and coin_delta > 0:
                # BUY: paid AUD, received coin.
                by_symbol[sym]["aud_spent"] += -aud_delta
                by_symbol[sym]["qty"] += coin_delta
            elif aud_delta > 0 and coin_delta < 0:
                # SELL: received AUD, gave coin. Reduce acquired pool proportionally.
                # We don't need this for cost basis of remaining coins *if* quantity
                # in holdings is already net-correct. Just log and skip.
                pass
        # Ignore: Deposits, Withdraws, Convert (coin→coin with no AUD).
        # User said Convert rows don't touch current holdings — will verify below.
    return by_symbol


def parse_swyftx(path: Path) -> dict[str, dict]:
    by_symbol = defaultdict(lambda: {"aud_spent": 0.0, "qty": 0.0, "rewards_aud": 0.0, "rewards_qty": 0.0})
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            event = row["Event"].strip().upper()
            if event not in ("BUY", "REWARD"):
                continue
            sym = row["Asset"].strip()
            try:
                amt = float(row["Amount"] or 0)
                aud = float(row["AUD_Value"] or 0)
            except ValueError:
                continue
            if event == "BUY":
                by_symbol[sym]["aud_spent"] += aud
                by_symbol[sym]["qty"] += amt
            elif event == "REWARD":
                # Staking reward — AUD_Value is the market value at receipt, i.e. cost basis.
                by_symbol[sym]["rewards_aud"] += aud
                by_symbol[sym]["rewards_qty"] += amt
            # Ignore SELL / everything else for basis of held coins.
    return by_symbol


def parse_ir(path: Path) -> dict[str, dict]:
    """Independent Reserve OrderStatement — skip the 'sep=,' first line."""
    by_symbol = defaultdict(lambda: {"aud_spent": 0.0, "qty": 0.0, "rewards_aud": 0.0, "rewards_qty": 0.0})
    with path.open() as f:
        lines = f.readlines()
        # Drop 'sep=,' meta line if present.
        if lines and lines[0].strip().lower().startswith("sep="):
            lines = lines[1:]
        reader = csv.DictReader(lines)
        for row in reader:
            if (row.get("Order Type") or "").strip() != "Market Buy":
                continue
            if (row.get("Secondary Currency") or "").strip() != "AUD":
                continue
            sym = (row.get("Primary Currency") or "").strip()
            try:
                qty = float(row["Volume"])
                cost = float(row["Total Cost"])
            except (ValueError, KeyError):
                continue
            by_symbol[sym]["aud_spent"] += cost
            by_symbol[sym]["qty"] += qty
    return by_symbol


def merge(*sources: dict) -> dict:
    out = defaultdict(lambda: {"aud_spent": 0.0, "qty": 0.0, "rewards_aud": 0.0, "rewards_qty": 0.0})
    for src in sources:
        for sym, d in src.items():
            out[sym]["aud_spent"] += d["aud_spent"]
            out[sym]["qty"] += d["qty"]
            out[sym]["rewards_aud"] += d["rewards_aud"]
            out[sym]["rewards_qty"] += d["rewards_qty"]
    return out


def load_holdings() -> dict[str, dict]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, UPPER(symbol) AS symbol, shares, cost_basis_per_share, current_price "
        "FROM holdings WHERE asset_class='crypto'"
    ).fetchall()
    conn.close()
    return {r["symbol"]: dict(r) for r in rows}


def report(apply: bool = False):
    bn = parse_binance(BINANCE_CSV)
    sw = parse_swyftx(SWYFTX_CSV)
    ir = parse_ir(IR_CSV)
    merged = merge(bn, sw, ir)
    holdings = load_holdings()

    print(f"{'SYM':<6} {'HELD_QTY':>14} {'OLD_CB':>12} {'BUY_AUD':>12} {'BUY_QTY':>14} "
          f"{'REW_AUD':>10} {'REW_QTY':>12} {'NEW_CB':>12} {'NEW_VAL_AUD':>14}")
    print("-" * 130)
    updates = []
    for sym, h in sorted(holdings.items()):
        m = merged.get(sym) or {"aud_spent": 0.0, "qty": 0.0, "rewards_aud": 0.0, "rewards_qty": 0.0}
        total_aud = m["aud_spent"] + m["rewards_aud"]
        total_qty = m["qty"] + m["rewards_qty"]
        new_cb = (total_aud / total_qty) if total_qty > 0 else None
        new_val = (h["shares"] * new_cb) if new_cb else None
        print(f"{sym:<6} {h['shares']:>14.6f} {h['cost_basis_per_share'] or 0:>12.2f} "
              f"{m['aud_spent']:>12.2f} {m['qty']:>14.6f} "
              f"{m['rewards_aud']:>10.2f} {m['rewards_qty']:>12.6f} "
              f"{(new_cb or 0):>12.2f} {(new_val or 0):>14.2f}")
        if new_cb is not None:
            updates.append((h["id"], sym, new_cb))

    if not apply:
        print("\nDRY RUN — pass --apply to write to DB.")
        return

    conn = sqlite3.connect(DB_PATH)
    for hid, sym, new_cb in updates:
        conn.execute("UPDATE holdings SET cost_basis_per_share = ? WHERE id = ?", (new_cb, hid))
    conn.commit()
    conn.close()
    print(f"\nUpdated {len(updates)} rows.")


if __name__ == "__main__":
    report(apply="--apply" in sys.argv)
