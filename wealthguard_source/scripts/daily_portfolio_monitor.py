#!/usr/bin/env python3
"""
WealthGuard Daily Portfolio Monitor
Runs weekdays at 8:00 AM
- Updates crypto prices
- Checks for >2% daily drop
- Saves report to /Reports/Daily/
- Sends Telegram alerts if configured
"""
import sys
sys.path.insert(0, '/root/.openclaw/workspace')
import wealthguard_utils as wg
from datetime import datetime
import sqlite3

# Optional Telegram notifications
try:
    from wealthguard_telegram import send_portfolio_alert
    TELEGRAM_AVAILABLE = True
except:
    TELEGRAM_AVAILABLE = False

DB_PATH = "/root/.openclaw/workspace/wealthguard.db"
REPORTS_DIR = "/root/.openclaw/workspace/Reports/Daily"

def main():
    today = datetime.now().strftime('%Y-%m-%d')
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    # Get previous day's portfolio value
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT net_worth FROM net_worth_history 
        ORDER BY snapshot_date DESC LIMIT 1
    """)
    result = cursor.fetchone()
    previous_value = result[0] if result else None
    conn.close()
    
    # Update prices
    print(f"[{timestamp}] Updating portfolio prices...")
    wg.update_portfolio_prices()
    
    # Get current valuation
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT SUM(shares * COALESCE(current_price, 0)) 
        FROM holdings WHERE asset_class = 'crypto'
    """)
    current_crypto = cursor.fetchone()[0] or 0
    conn.close()
    
    # Calculate change
    report_lines = []
    report_lines.append("=" * 70)
    report_lines.append(f"WEALTHGUARD DAILY PORTFOLIO REPORT - {today}")
    report_lines.append("=" * 70)
    report_lines.append(f"Generated: {timestamp}")
    report_lines.append("")
    
    # Get detailed portfolio
    portfolio_report = wg.get_portfolio_valuation()
    report_lines.append(portfolio_report)
    
    # Check for >2% drop alert
    alert_triggered = False
    if previous_value and previous_value > 0:
        # Get total current value including crypto
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT SUM(current_balance) FROM accounts WHERE type IN ('checking', 'savings')")
        cash = cursor.fetchone()[0] or 0
        cursor.execute("SELECT SUM(shares * COALESCE(current_price, 0)) FROM holdings")
        investments = cursor.fetchone()[0] or 0
        conn.close()
        
        current_total = cash + investments
        change_pct = ((current_total - previous_value) / previous_value) * 100
        
        report_lines.append(f"\n📊 DAY-OVER-DAY CHANGE")
        report_lines.append(f"   Previous: AUD ${previous_value:,.2f}")
        report_lines.append(f"   Current:  AUD ${current_total:,.2f}")
        report_lines.append(f"   Change:   {change_pct:+.2f}%")
        
        if change_pct < -2:
            alert_triggered = True
            report_lines.append(f"\n🚨 CRITICAL ALERT: Portfolio dropped {abs(change_pct):.2f}%!")
            report_lines.append(f"   Action recommended: Review positions and market conditions.")
            
            # Send Telegram alert
            if TELEGRAM_AVAILABLE:
                send_portfolio_alert(change_pct, current_total, previous_value)
    
    # Write report
    report_text = "\n".join(report_lines)
    filename = f"{REPORTS_DIR}/Portfolio_{today}.txt"
    with open(filename, 'w') as f:
        f.write(report_text)
    
    print(f"✅ Report saved: {filename}")
    
    if alert_triggered:
        print("🚨 CRITICAL: Portfolio drop >2% detected!")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main())
