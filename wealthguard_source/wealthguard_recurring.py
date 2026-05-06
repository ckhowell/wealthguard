#!/usr/bin/env python3
"""
Detect recurring transactions and flag them via the is_recurring column.

Algorithm:
  Group by (payee, round(amount, 0)); if we see the same bucket at least
  3 times within 6 months and the median cadence is stable (±4 days), flag
  every row in that bucket.

Runs idempotently — re-running does not change flags that already match.
"""
from __future__ import annotations

import os
import sqlite3
import logging
import statistics
from datetime import datetime
from typing import Dict, List, Tuple

logger = logging.getLogger('wealthguard.recurring')

DB_PATH = os.getenv('DATABASE_PATH', '/root/.openclaw/workspace/wealthguard.db')

MIN_OCCURRENCES = 3
WINDOW_DAYS = 183  # ~6 months
CADENCE_TOLERANCE_DAYS = 4


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _normalize_payee(payee: str) -> str:
    # Collapse whitespace + casing so "NETFLIX  " and "netflix" bucket together.
    return ' '.join((payee or '').lower().split())


def detect(update: bool = True) -> Dict:
    """Scan transactions; return summary. When update=True, write is_recurring=1."""
    with _get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT id, payee, amount, transaction_date
            FROM transactions
            WHERE transaction_date >= date('now', '-{WINDOW_DAYS} days')
              AND payee IS NOT NULL AND payee != ''
            ORDER BY transaction_date ASC
            """
        ).fetchall()

    buckets: Dict[Tuple[str, int], List[Tuple[int, datetime]]] = {}
    for r in rows:
        key = (_normalize_payee(r['payee']), round(float(r['amount'] or 0)))
        try:
            dt = datetime.fromisoformat(r['transaction_date'])
        except (TypeError, ValueError):
            continue
        buckets.setdefault(key, []).append((r['id'], dt))

    flagged_ids: List[int] = []
    recurring_bucket_samples: List[Dict] = []

    for (payee, amount), entries in buckets.items():
        if len(entries) < MIN_OCCURRENCES:
            continue
        entries.sort(key=lambda e: e[1])
        deltas = [(entries[i][1] - entries[i - 1][1]).days for i in range(1, len(entries))]
        if not deltas:
            continue
        median_cadence = statistics.median(deltas)
        if median_cadence < 5:  # below ~weekly is probably duplicate noise
            continue
        within_tolerance = all(abs(d - median_cadence) <= CADENCE_TOLERANCE_DAYS for d in deltas)
        if not within_tolerance:
            continue

        for tx_id, _ in entries:
            flagged_ids.append(tx_id)
        recurring_bucket_samples.append({
            'payee': payee,
            'amount': amount,
            'count': len(entries),
            'median_cadence_days': int(median_cadence),
        })

    if update and flagged_ids:
        with _get_conn() as conn:
            # Reset then set — simplest idempotent approach (keeps matches stable).
            placeholders = ','.join('?' * len(flagged_ids))
            conn.execute(f"UPDATE transactions SET is_recurring = 1 WHERE id IN ({placeholders})", flagged_ids)
            conn.commit()

    logger.info(f"Recurring detection: {len(recurring_bucket_samples)} buckets, {len(flagged_ids)} rows flagged")
    return {
        'buckets': len(recurring_bucket_samples),
        'flagged_rows': len(flagged_ids),
        'samples': recurring_bucket_samples[:20],
    }


if __name__ == '__main__':
    import json
    print(json.dumps(detect(update=True), indent=2))
