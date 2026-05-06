"""
WealthGuard holistic Advisor — deterministic rule engine + optional LLM narrative.

Surface area:
    build_recommendations(conn, fx) -> dict (kpis, recommendations, generated_at)

Rules cover seven wealth dimensions:
    cash, expenses, investments, tax, debt, goals, net_worth

Each Recommendation is a dict:
    {
      "id": str,          # stable id, used as React key
      "kind": str,        # one of the seven above
      "severity": "low|med|high",
      "title": str,
      "detail": str,
      "evidence": str,    # data behind the rec (numbers, source rows)
      "action": str,      # what to do
      "est_impact_aud_per_year": float | None,
      "links": [str],     # in-app routes for drill-down
    }
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional


# --- helpers ---------------------------------------------------------------

def _money_out_for_period(conn, days: int, fx: Callable[[str, str], float]) -> float:
    """Total LIVING spend over the last N days, AUD-converted. Excludes
    transfers + `Investment` / `Transfers` categories — those are asset moves,
    not consumption, and distort the savings-rate calc + cash-hoard ratio."""
    rows = conn.execute(
        f"""SELECT COALESCE(currency,'AUD') AS ccy, -SUM(amount) AS amt
            FROM transactions
            WHERE amount < 0 AND transaction_type != 'transfer'
              AND (category IS NULL OR category NOT IN ('Investment', 'Transfers'))
              AND transaction_date >= date('now', '-{days} days')
            GROUP BY ccy""",
    ).fetchall()
    return sum((r['amt'] or 0) * fx(r['ccy'].upper(), 'AUD') for r in rows)


def _money_in_for_period(conn, days: int, fx: Callable[[str, str], float]) -> float:
    rows = conn.execute(
        f"""SELECT COALESCE(currency,'AUD') AS ccy, SUM(amount) AS amt
            FROM transactions
            WHERE amount > 0 AND transaction_type != 'transfer'
              AND transaction_date >= date('now', '-{days} days')
            GROUP BY ccy""",
    ).fetchall()
    return sum((r['amt'] or 0) * fx(r['ccy'].upper(), 'AUD') for r in rows)


# --- rules -----------------------------------------------------------------

def _rule_cash_idle(conn, fx) -> List[Dict]:
    """Flag cash balances earning materially below the best APY available."""
    rows = conn.execute(
        "SELECT id, name, currency, current_balance, apy "
        "FROM accounts WHERE is_active = 1 AND type IN ('savings','checking')"
    ).fetchall()
    if not rows:
        return []
    # Best APY available across the user's own accounts.
    best_apy = max((r['apy'] or 0) for r in rows)
    out: List[Dict] = []
    for r in rows:
        balance_native = r['current_balance'] or 0
        if balance_native <= 0:
            continue
        apy = r['apy'] or 0
        balance_aud = balance_native * fx((r['currency'] or 'AUD').upper(), 'AUD')
        # Only flag idle cash with a >0.5% gap and worth at least $1k AUD.
        if balance_aud >= 1000 and best_apy - apy > 0.5:
            gap_pct = best_apy - apy
            est_yield = balance_aud * gap_pct / 100
            severity = 'high' if est_yield > 1000 else ('med' if est_yield > 200 else 'low')
            out.append({
                'id': f'cash-idle-{r["id"]}',
                'kind': 'cash',
                'severity': severity,
                'title': f'{r["name"]} is earning {apy:.2f}% — best you have is {best_apy:.2f}%',
                'detail': f'Move funds (or part of) to your higher-yield account.',
                'evidence': f'Balance ≈ ${balance_aud:,.0f} AUD at {apy:.2f}% APY. Gap vs best account: {gap_pct:.2f}%.',
                'action': f'Transfer to your highest-APY account ({best_apy:.2f}%); even partial reallocation captures most of the upside.',
                'est_impact_aud_per_year': round(est_yield, 0),
                'links': ['/portfolio'],
            })
    return out


def _rule_cash_hoard(conn, fx, monthly_expenses_avg: float) -> List[Dict]:
    """Flag if cash on hand > 12 months of expenses (excess could be invested)."""
    if monthly_expenses_avg <= 0:
        return []
    cash_total = 0.0
    rows = conn.execute(
        "SELECT current_balance, currency FROM accounts "
        "WHERE is_active = 1 AND type IN ('savings','checking')"
    ).fetchall()
    for r in rows:
        cash_total += (r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD')
    runway_months = cash_total / monthly_expenses_avg if monthly_expenses_avg > 0 else 0
    if runway_months > 12:
        excess = cash_total - (monthly_expenses_avg * 6)  # keep 6mo buffer
        # Conservative est: excess in a balanced ETF ~5%/yr real return.
        return [{
            'id': 'cash-hoard',
            'kind': 'cash',
            'severity': 'med',
            'title': f'You have {runway_months:.0f} months of expenses in cash',
            'detail': 'A 3-6 month emergency buffer is the typical recommendation. The rest is opportunity cost vs. invested.',
            'evidence': f'Cash ≈ ${cash_total:,.0f}, monthly spend ≈ ${monthly_expenses_avg:,.0f}.',
            'action': f'Consider moving up to ${excess:,.0f} into a diversified equity/ETF position; expected uplift ~5% real return.',
            'est_impact_aud_per_year': round(excess * 0.05, 0),
            'links': ['/portfolio'],
        }]
    return []


def _rule_savings_rate(conn, fx, money_in: float, money_out: float) -> List[Dict]:
    if money_in <= 0:
        return []
    rate = (money_in - money_out) / money_in * 100
    if rate >= 20:
        return []
    severity = 'high' if rate < 0 else ('med' if rate < 10 else 'low')
    return [{
        'id': 'savings-rate-low',
        'kind': 'expenses',
        'severity': severity,
        'title': f'Savings rate is {rate:.0f}% over the last 90 days',
        'detail': '20%+ is a common rule-of-thumb for accelerated wealth-building.',
        'evidence': f'Income ≈ ${money_in:,.0f}, spend ≈ ${money_out:,.0f}, surplus ${money_in-money_out:,.0f}.',
        'action': 'Review the Expenses page → identify your top 3 controllable categories and trim 10-20%.',
        'est_impact_aud_per_year': None,
        'links': ['/expenses'],
    }]


def _rule_top_movers(conn, fx) -> List[Dict]:
    """Flag any category whose this-month spend is >50% above the trailing 12-month avg.
    Excludes `Investment` and `Transfers` — those are asset moves, not living burn,
    and produced a persistent false "196% above avg" alarm for this user."""
    cur_rows = conn.execute(
        """SELECT category, COALESCE(currency,'AUD') AS ccy, -SUM(amount) AS amt
           FROM transactions
           WHERE amount < 0 AND transaction_type != 'transfer'
             AND strftime('%Y-%m', transaction_date) = strftime('%Y-%m','now')
             AND category IS NOT NULL
             AND category NOT IN ('Investment', 'Transfers')
           GROUP BY category, ccy""",
    ).fetchall()
    cur_by_cat: Dict[str, float] = {}
    for r in cur_rows:
        cur_by_cat[r['category']] = cur_by_cat.get(r['category'], 0) + (r['amt'] or 0) * fx(r['ccy'].upper(), 'AUD')

    avg_rows = conn.execute(
        """SELECT category, COALESCE(currency,'AUD') AS ccy, -SUM(amount) AS amt, COUNT(DISTINCT strftime('%Y-%m', transaction_date)) AS months
           FROM transactions
           WHERE amount < 0 AND transaction_type != 'transfer'
             AND transaction_date >= date('now', '-12 months')
             AND transaction_date < date('now','start of month')
             AND category IS NOT NULL
             AND category NOT IN ('Investment', 'Transfers')
           GROUP BY category, ccy""",
    ).fetchall()
    avg_by_cat: Dict[str, float] = {}
    months_seen: Dict[str, int] = {}
    for r in avg_rows:
        avg_by_cat[r['category']] = avg_by_cat.get(r['category'], 0) + (r['amt'] or 0) * fx(r['ccy'].upper(), 'AUD')
        months_seen[r['category']] = max(months_seen.get(r['category'], 0), r['months'] or 1)

    out: List[Dict] = []
    for cat, cur in cur_by_cat.items():
        avg = (avg_by_cat.get(cat, 0) / months_seen.get(cat, 1)) if cat in avg_by_cat else 0
        if avg <= 50 or cur < avg * 1.5:
            continue
        delta = cur - avg
        pct = (cur - avg) / avg * 100
        out.append({
            'id': f'expense-spike-{cat.replace(" ", "-").lower()}',
            'kind': 'expenses',
            'severity': 'med' if pct > 100 else 'low',
            'title': f'{cat} spend is {pct:.0f}% above your 12-mo avg this month',
            'detail': f'Currently ${cur:,.0f} this month vs. ${avg:,.0f} avg.',
            'evidence': f'12-month average across {months_seen.get(cat,1)} months observed.',
            'action': 'Open the Expenses page and click into this category to see what drove it.',
            'est_impact_aud_per_year': round(delta * 12, 0) if pct > 100 else None,
            'links': ['/expenses'],
        })
    out.sort(key=lambda r: -(r['est_impact_aud_per_year'] or 0))
    return out[:3]


def _rule_credit_card_carry(conn, fx) -> List[Dict]:
    """Flag credit-card balances carried month-on-month (i.e. negative current_balance on a credit account)."""
    rows = conn.execute(
        "SELECT id, name, currency, current_balance FROM accounts "
        "WHERE is_active = 1 AND type = 'credit'"
    ).fetchall()
    out: List[Dict] = []
    for r in rows:
        bal = r['current_balance'] or 0
        # Credit cards usually store balance as negative (you owe).
        owed_native = -bal if bal < 0 else 0
        if owed_native <= 100:
            continue
        owed_aud = owed_native * fx((r['currency'] or 'AUD').upper(), 'AUD')
        # Assume CC interest ~21% pa.
        est_cost = owed_aud * 0.21
        out.append({
            'id': f'cc-carry-{r["id"]}',
            'kind': 'debt',
            'severity': 'high',
            'title': f'{r["name"]} balance: ${owed_aud:,.0f}',
            'detail': 'Carrying credit-card debt costs ~21% pa. Highest-priority dollar to pay down.',
            'evidence': f'Credit-account balance owed.',
            'action': 'Pay this off before any other discretionary investment; redirect surplus from savings if you have >6 mo runway.',
            'est_impact_aud_per_year': round(est_cost, 0),
            'links': ['/portfolio'],
        })
    return out


def _rule_concentration(conn, fx) -> List[Dict]:
    """Flag single positions >25% of total investment book."""
    rows = conn.execute(
        """SELECT symbol, asset_name, shares, current_price,
                  COALESCE(native_currency,'USD') AS ccy
           FROM holdings
           WHERE shares > 0 AND asset_class IN ('equity','etf','crypto')"""
    ).fetchall()
    positions = []
    total = 0.0
    for r in rows:
        v = (r['shares'] or 0) * (r['current_price'] or 0) * fx(r['ccy'].upper(), 'AUD')
        positions.append({'symbol': r['symbol'], 'name': r['asset_name'], 'value': v})
        total += v
    if total <= 0:
        return []
    out: List[Dict] = []
    for p in positions:
        pct = p['value'] / total * 100
        if pct < 25 or p['value'] < 5000:
            continue
        out.append({
            'id': f'concentration-{p["symbol"]}',
            'kind': 'investments',
            'severity': 'med' if pct < 40 else 'high',
            'title': f'{p["symbol"]} is {pct:.0f}% of your investment book',
            'detail': f'A single name >25% leaves you exposed to idiosyncratic risk.',
            'evidence': f'{p["name"]}: ${p["value"]:,.0f} of ${total:,.0f} total invested.',
            'action': 'Consider trimming or hedging; rebalance into your underweight categories (see Rebalancer).',
            'est_impact_aud_per_year': None,
            'links': ['/portfolio', '/rebalancer'],
        })
    return out


def _rule_unrealised_loss(conn, fx) -> List[Dict]:
    """Flag positions down >20% from cost basis (potential tax-loss-harvest candidates)."""
    rows = conn.execute(
        """SELECT symbol, asset_name, shares, current_price, cost_basis_per_share,
                  COALESCE(native_currency,'USD') AS ccy
           FROM holdings
           WHERE shares > 0 AND asset_class IN ('equity','etf','crypto')
             AND current_price IS NOT NULL AND cost_basis_per_share IS NOT NULL"""
    ).fetchall()
    out: List[Dict] = []
    for r in rows:
        cost = r['cost_basis_per_share'] or 0
        price = r['current_price'] or 0
        if cost <= 0 or price <= 0:
            continue
        change = (price - cost) / cost * 100
        if change >= -10:
            continue
        loss_aud = (cost - price) * (r['shares'] or 0) * fx(r['ccy'].upper(), 'AUD')
        if loss_aud < 200:
            continue
        out.append({
            'id': f'unrealised-loss-{r["symbol"]}',
            'kind': 'tax',
            'severity': 'low' if change > -25 else 'med',
            'title': f'{r["symbol"]} is down {abs(change):.0f}% from cost',
            'detail': 'Potential tax-loss-harvest candidate before financial year-end.',
            'evidence': f'{r["asset_name"]}: cost ${cost:.2f} → ${price:.2f}, loss ≈ ${loss_aud:,.0f} AUD.',
            'action': 'Discuss with your accountant before the EOFY (30 Jun in AU) if you have realised gains to offset.',
            'est_impact_aud_per_year': None,
            'links': ['/portfolio'],
        })
    out.sort(key=lambda r: r['evidence'])
    return out[:5]


def _rule_goals(conn, fx, net_worth_aud: float) -> List[Dict]:
    rows = conn.execute(
        "SELECT id, name, target_amount, target_date FROM goals"
    ).fetchall()
    today = datetime.utcnow().date()
    out: List[Dict] = []
    for r in rows:
        target = r['target_amount'] or 0
        if target <= 0 or not r['target_date']:
            continue
        try:
            target_date = datetime.fromisoformat(r['target_date']).date()
        except Exception:
            continue
        months_left = max(1, (target_date.year - today.year) * 12 + (target_date.month - today.month))
        gap = target - net_worth_aud
        if gap <= 0:
            out.append({
                'id': f'goal-met-{r["id"]}',
                'kind': 'goals',
                'severity': 'low',
                'title': f'Goal met: {r["name"]}',
                'detail': f'Net worth has surpassed the target ${target:,.0f}.',
                'evidence': f'Net worth ${net_worth_aud:,.0f} ≥ target ${target:,.0f}',
                'action': 'Mark the goal complete or set the next milestone.',
                'est_impact_aud_per_year': None,
                'links': ['/goals'],
            })
            continue
        required_monthly = gap / months_left
        out.append({
            'id': f'goal-pace-{r["id"]}',
            'kind': 'goals',
            'severity': 'med' if required_monthly > 5000 else 'low',
            'title': f'{r["name"]}: ${gap:,.0f} to go in {months_left} months',
            'detail': f'Required net new worth: ${required_monthly:,.0f}/mo.',
            'evidence': f'Target ${target:,.0f} by {target_date}; current net worth ${net_worth_aud:,.0f}.',
            'action': 'Compare against your current savings rate. If short, raise income, cut spend, or extend the date.',
            'est_impact_aud_per_year': None,
            'links': ['/goals'],
        })
    return out


# --- main entrypoint -------------------------------------------------------

def build_recommendations(conn, fx, net_worth_aud: float) -> Dict:
    money_in_90 = _money_in_for_period(conn, 90, fx)
    money_out_90 = _money_out_for_period(conn, 90, fx)
    monthly_in_avg = money_in_90 / 3 if money_in_90 else 0
    monthly_out_avg = money_out_90 / 3 if money_out_90 else 0
    savings_rate_pct = ((money_in_90 - money_out_90) / money_in_90 * 100) if money_in_90 > 0 else 0

    # cash totals
    cash_aud = 0.0
    for r in conn.execute(
        "SELECT current_balance, currency FROM accounts "
        "WHERE is_active = 1 AND type IN ('savings','checking')"
    ).fetchall():
        cash_aud += (r['current_balance'] or 0) * fx((r['currency'] or 'AUD').upper(), 'AUD')
    runway_months = (cash_aud / monthly_out_avg) if monthly_out_avg > 0 else None

    # debt totals (credit accounts with negative balance)
    debt_aud = 0.0
    for r in conn.execute(
        "SELECT current_balance, currency FROM accounts WHERE is_active = 1 AND type = 'credit'"
    ).fetchall():
        bal = r['current_balance'] or 0
        if bal < 0:
            debt_aud += -bal * fx((r['currency'] or 'AUD').upper(), 'AUD')

    debt_to_asset_pct = (debt_aud / net_worth_aud * 100) if net_worth_aud > 0 else 0

    recs: List[Dict] = []
    recs += _rule_cash_idle(conn, fx)
    recs += _rule_cash_hoard(conn, fx, monthly_out_avg)
    recs += _rule_savings_rate(conn, fx, money_in_90, money_out_90)
    recs += _rule_top_movers(conn, fx)
    recs += _rule_credit_card_carry(conn, fx)
    recs += _rule_concentration(conn, fx)
    recs += _rule_unrealised_loss(conn, fx)
    recs += _rule_goals(conn, fx, net_worth_aud)

    # Sort by severity then by impact desc.
    sev_rank = {'high': 0, 'med': 1, 'low': 2}
    recs.sort(key=lambda r: (sev_rank.get(r['severity'], 3), -(r.get('est_impact_aud_per_year') or 0)))

    # Wealth health score: starts at 100, deducts for severity-weighted recs.
    score = 100
    for r in recs:
        if r['severity'] == 'high':
            score -= 8
        elif r['severity'] == 'med':
            score -= 4
        else:
            score -= 1
    score = max(0, min(100, score))

    return {
        'generated_at': datetime.utcnow().isoformat() + 'Z',
        'wealth_health_score': score,
        'kpis': {
            'net_worth_aud': round(net_worth_aud, 2),
            'cash_aud': round(cash_aud, 2),
            'debt_aud': round(debt_aud, 2),
            'monthly_income_avg_aud': round(monthly_in_avg, 2),
            'monthly_expenses_avg_aud': round(monthly_out_avg, 2),
            'savings_rate_pct': round(savings_rate_pct, 1),
            'runway_months': round(runway_months, 1) if runway_months else None,
            'debt_to_asset_pct': round(debt_to_asset_pct, 2),
        },
        'recommendations': recs,
    }
