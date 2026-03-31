#!/usr/bin/env python3
"""
WealthGuard Daily Budget Check
Runs daily at 9:00 AM
- Checks all budget categories
- Alerts if any >80%
- Appends to daily status log
"""
import sys
sys.path.insert(0, '/root/.openclaw/workspace')
from wealthguard_utils import check_budget_status
from datetime import datetime

LOG_FILE = "/root/.openclaw/workspace/Reports/daily_status.log"

def main():
    today = datetime.now().strftime('%Y-%m-%d')
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    print(f"[{timestamp}] Checking budget status...")
    
    # Get budget report
    budget_report = check_budget_status()
    
    # Check for alerts (>80% used)
    alert_lines = []
    for line in budget_report.split('\n'):
        if '🔴' in line or '🟠' in line:
            alert_lines.append(line)
    
    # Prepare log entry
    log_entry = f"""
{'='*70}
BUDGET CHECK - {today} {timestamp}
{'='*70}
{budget_report}

ALERTS SUMMARY:
{chr(10).join(alert_lines) if alert_lines else '✅ No alerts - all budgets on track'}

"""
    
    # Append to log
    with open(LOG_FILE, 'a') as f:
        f.write(log_entry)
    
    print(f"✅ Budget check complete. Logged to {LOG_FILE}")
    
    # Return alert count for cron notification
    if alert_lines:
        print(f"🚨 {len(alert_lines)} budget alert(s) detected!")
        return len(alert_lines)
    
    return 0

if __name__ == "__main__":
    exit(main())
