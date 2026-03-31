#!/usr/bin/env python3
"""
WealthGuard Telegram Notification Module
"""
import os
import json

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False
    print("⚠️ requests library not available")

# Telegram configuration - UPDATED
BOT_TOKEN = "8333759366:AAGyK5X2W1Iq6jb0DVqgaxdZUriJG35fDG4"
CHAT_ID = "8504580841"

def send_message(message, parse_mode="HTML"):
    """
    Send a message to the configured Telegram chat
    """
    if not BOT_TOKEN or not CHAT_ID:
        print("⚠️ Telegram not configured")
        return False
    
    if not REQUESTS_AVAILABLE:
        print("⚠️ requests library required for Telegram")
        return False
    
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    
    payload = {
        "chat_id": CHAT_ID,
        "text": message,
        "parse_mode": parse_mode,
        "disable_web_page_preview": True
    }
    
    try:
        response = requests.post(url, json=payload, timeout=30)
        result = response.json()
        if result.get('ok'):
            print("✅ Telegram notification sent")
            return True
        else:
            print(f"⚠️ Telegram API error: {result.get('description', 'Unknown error')}")
            return False
    except Exception as e:
        print(f"⚠️ Failed to send Telegram notification: {e}")
        return False

def send_portfolio_alert(change_pct, current_value, previous_value):
    """
    Send portfolio drop alert
    """
    emoji = "🚨" if change_pct < -5 else "⚠️"
    message = f"""{emoji} <b>WEALTHGUARD ALERT: Portfolio Drop</b> {emoji}

📉 <b>Change:</b> {change_pct:.2f}%
💰 <b>Current Value:</b> AUD ${current_value:,.2f}
📊 <b>Previous Value:</b> AUD ${previous_value:,.2f}

<i>Threshold: -2% | Action recommended: Review positions</i>
"""
    return send_message(message)

def send_budget_alert(category, spent, budget, percent_used):
    """
    Send budget overrun alert
    """
    emoji = "🔴" if percent_used > 100 else "🟠"
    status = "OVER BUDGET" if percent_used > 100 else f"{percent_used:.0f}% used"
    
    message = f"""{emoji} <b>WEALTHGUARD: Budget Alert</b> {emoji}

📂 <b>Category:</b> {category}
💵 <b>Spent:</b> AUD ${spent:,.2f} / ${budget:,.2f}
📊 <b>Status:</b> {status}

<i>Threshold: 80% | Review your spending</i>
"""
    return send_message(message)

def send_daily_summary(net_worth, cash, investments, alerts=None):
    """
    Send daily net worth summary
    """
    alert_section = ""
    if alerts:
        alert_section = f"\n⚠️ <b>Active Alerts:</b> {len(alerts)}\n"
        for alert in alerts:
            alert_section += f"   • {alert}\n"
    
    message = f"""📊 <b>WEALTHGUARD DAILY SUMMARY</b>

💰 <b>Net Worth:</b> AUD ${net_worth:,.2f}
💵 <b>Cash:</b> AUD ${cash:,.2f}
📈 <b>Investments:</b> AUD ${investments:,.2f}
{alert_section}
<i>Updated: Daily at 11:59 PM</i>
"""
    return send_message(message)

def test_connection():
    """
    Test Telegram connection
    """
    return send_message("🤖 <b>WealthGuard Bot</b> is now active!\n\nYou'll receive alerts for:\n• Portfolio drops >2%\n• Budget overruns >80%\n• Daily net worth summaries")

if __name__ == "__main__":
    print("Testing Telegram connection...")
    test_connection()
