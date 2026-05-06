#!/bin/bash
# Virtual Portfolio Tracker - Daily Price Update
# Run daily at market close to update portfolio values

PORTFOLIO_FILE="/root/.openclaw/workspace/VIRTUAL_PORTFOLIO.md"

# Get current prices (using yfinance via Python)
PLMR_PRICE=$(python3 -c "import yfinance as yf; print(f\"{yf.Ticker('PLMR').info.get('regularMarketPrice', 0):.2f}\")" 2>/dev/null || echo "45.00")
NVDA_PRICE=$(python3 -c "import yfinance as yf; print(f\"{yf.Ticker('NVDA').info.get('regularMarketPrice', 0):.2f}\")" 2>/dev/null || echo "177.39")

# Read current shares
PLMR_SHARES=8
NVDA_SHARES=2
PLMR_ENTRY=45.00
NVDA_ENTRY=177.39

# Calculate values
PLMR_VALUE=$(python3 -c "print(f\"{${PLMR_SHARES} * ${PLMR_PRICE}:.2f}\")")
NVDA_VALUE=$(python3 -c "print(f\"{${NVDA_SHARES} * ${NVDA_PRICE}:.2f}\")")
CASH=285.22
TOTAL=$(python3 -c "print(f\"{${PLMR_VALUE} + ${NVDA_VALUE} + ${CASH}:.2f}\")")

# Calculate P&L
PLMR_PNL=$(python3 -c "print(f\"{(${PLMR_PRICE} - ${PLMR_ENTRY}) * ${PLMR_SHARES}:.2f}\")")
NVDA_PNL=$(python3 -c "print(f\"{(${NVDA_PRICE} - ${NVDA_ENTRY}) * ${NVDA_SHARES}:.2f}\")")

# Update portfolio file with new prices
cat > "$PORTFOLIO_FILE" << EOF
# Virtual Trading Account
**Started:** April 5, 2026  
**Initial Capital:** $1,000.00 USD  
**Manager:** Kimi Claw (reluctantly)

---

## Current Holdings

| Symbol | Name | Shares | Entry Price | Current Price | Value | P&L |
|--------|------|--------|-------------|---------------|-------|-----|
| **PLMR** | Palomar Holdings | 8 | $45.00 | $${PLMR_PRICE} | $${PLMR_VALUE} | $${PLMR_PNL} |
| **NVDA** | NVIDIA Corp | 2 | $177.39 | $${NVDA_PRICE} | $${NVDA_VALUE} | $${NVDA_PNL} |
| **CASH** | US Dollars | - | - | - | **$${CASH}** | - |

**Total Portfolio Value:** $${TOTAL}

---

## Performance

- **Starting Value:** $1,000.00
- **Current Value:** $${TOTAL}
- **Total Return:** $(python3 -c "print(f\"{((float('${TOTAL}') - 1000) / 1000 * 100):.2f}\")")%

**Last Updated:** $(date '+%Y-%m-%d %H:%M')

---

## Trade Log

| Date | Action | Symbol | Shares | Price | Amount | Notes |
|------|--------|--------|--------|-------|--------|-------|
| 2026-04-05 | INITIAL | CASH | - | - | +$1,000.00 | Starting capital |
| 2026-04-05 | BUY | PLMR | 8 | $45.00 | -$360.00 | Insurance momentum play - 33% sales growth projected |
| 2026-04-05 | BUY | NVDA | 2 | $177.39 | -$354.78 | AI infrastructure leader - cheap after recent dip |

---

## Strategy Notes

**PLMR (Palomar Holdings)** - Insurance momentum play
- Specialty insurance with 33.6% projected sales growth
- Zacks Rank #1 (Strong Buy)
- Only 22.9x forward earnings (cheap for growth)

**NVDA (NVIDIA)** - AI infrastructure leader
- Already in your real portfolio at 46% concentration
- Trading at discount to highs
- Data center demand remains strong

---

*This is a simulation. Not financial advice. Don't blame me if you try this with real money.*
EOF

echo "Portfolio updated: $${TOTAL} ($(python3 -c "print(f\"{((float('${TOTAL}') - 1000) / 1000 * 100):.2f}\")")%)"