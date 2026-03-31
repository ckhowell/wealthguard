#!/usr/bin/env python3
"""
WealthGuard Net Worth Snapshot
Runs daily at 11:59 PM
- Calculates total assets and liabilities
- Records to net_worth_history
- Generates trend analysis if >30 days data
"""
import sys
sys.path.insert(0, '/root/.openclaw/workspace')
import wealthguard_utils as wg
from datetime import datetime, timedelta
import sqlite3

DB_PATH = "/root/.openclaw/workspace/wealthguard.db"

def main():
    today = datetime.now().strftime('%Y-%m-%d')
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    print(f"[{timestamp}] Calculating net worth...")
    
    # Record net worth
    net_worth = wg.update_net_worth()
    
    # Get detailed breakdown
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Calculate components
    cursor.execute("""
        SELECT 
            SUM(CASE 
                WHEN currency = 'JPY' THEN current_balance * 0.009117
                ELSE current_balance 
            END) as total_assets
        FROM accounts
        WHERE is_active = 1
          AND type IN ('checking', 'savings')
    """)
    total_assets = cursor.fetchone()[0] or 0
    
    cursor.execute("""
        SELECT SUM(shares * COALESCE(current_price, 0)) 
        FROM holdings
    """)
    investments = cursor.fetchone()[0] or 0
    total_assets += investments
    
    cursor.execute("""
        SELECT SUM(current_balance) FROM accounts WHERE type = 'credit'
    """)
    liabilities = cursor.fetchone()[0] or 0
    
    # Get historical data for trend
    cursor.execute("""
        SELECT snapshot_date, net_worth 
        FROM net_worth_history 
        ORDER BY snapshot_date DESC
        LIMIT 30
    """)
    history = cursor.fetchall()
    
    conn.close()
    
    # Generate report
    report_lines = []
    report_lines.append("=" * 70)
    report_lines.append(f"NET WORTH SNAPSHOT - {today}")
    report_lines.append("=" * 70)
    report_lines.append(f"Timestamp: {timestamp}")
    report_lines.append("")
    report_lines.append(f"💰 Total Assets:      AUD ${total_assets:,.2f}")
    report_lines.append(f"   - Cash/Savings:   AUD ${total_assets - investments:,.2f}")
    report_lines.append(f"   - Investments:    AUD ${investments:,.2f}")
    report_lines.append(f"💳 Total Liabilities: AUD ${liabilities:,.2f}")
    report_lines.append(f"📊 Net Worth:         AUD ${net_worth:,.2f}")
    report_lines.append("")
    
    # Trend analysis if >30 days
    if len(history) >= 30:
        first = history[-1]  # Oldest
        last = history[0]    # Most recent
        days = (datetime.strptime(last['snapshot_date'], '%Y-%m-%d') - 
                datetime.strptime(first['snapshot_date'], '%Y-%m-%d')).days
        
        if days > 0:
            change = last['net_worth'] - first['net_worth']
            change_pct = (change / first['net_worth']) * 100 if first['net_worth'] > 0 else 0
            annualized = (change_pct / days) * 365
            
            report_lines.append("📈 30-DAY TREND ANALYSIS")
            report_lines.append(f"   Period: {first['snapshot_date']} to {last['snapshot_date']}")
            report_lines.append(f"   Change: AUD ${change:,.2f} ({change_pct:+.2f}%)")
            report_lines.append(f"   Days:   {days}")
            report_lines.append(f"   Annualized Growth: {annualized:+.2f}%")
            
            # Simple moving average
            if len(history) >= 7:
                last_7 = sum(h['net_worth'] for h in history[:7]) / 7
                report_lines.append(f"   7-Day Avg: AUD ${last_7:,.2f}")
    else:
        report_lines.append(f"📊 Data Points: {len(history)} (Trend analysis available at 30 days)")
    
    report_lines.append("=" * 70)
    
    report_text = "\n".join(report_lines)
    print(report_text)
    
    # Save to daily report
    report_file = f"/root/.openclaw/workspace/Reports/Daily/NetWorth_{today}.txt"
    with open(report_file, 'w') as f:
        f.write(report_text)
    
    print(f"\n✅ Net worth recorded: AUD ${net_worth:,.2f}")
    print(f"✅ Report saved: {report_file}")
    
    return 0

if __name__ == "__main__":
    exit(main())
