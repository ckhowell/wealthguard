#!/usr/bin/env python3
"""
WealthGuard Price Alerts System
Monitors portfolio and sends alerts on significant price movements
"""

import os
import json
import sqlite3
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from dataclasses import dataclass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('wealthguard.alerts')

DB_PATH = os.getenv('DATABASE_PATH', '/root/.openclaw/workspace/wealthguard.db')

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '8333759366:AAGyK5X2W1Iq6jb0DVqgaxdZUriJG35fDG4')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID', '8504580841')


@dataclass
class PriceAlert:
    symbol: str
    alert_type: str  # 'gain', 'loss', 'threshold_high', 'threshold_low'
    current_price: float
    previous_price: float
    change_percent: float
    message: str
    severity: str  # 'info', 'warning', 'critical'


class AlertManager:
    """Manages price alerts and notifications"""
    
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
    
    def get_db_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    
    def ensure_tables(self):
        """Create alert tables if they don't exist"""
        with self.get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Alert configuration table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS price_alert_config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT,
                    alert_type TEXT,  -- 'percent_change', 'threshold_high', 'threshold_low'
                    threshold_value REAL,  -- percent or price value
                    is_active BOOLEAN DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Alert history table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS price_alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    alert_type TEXT NOT NULL,
                    current_price REAL,
                    previous_price REAL,
                    change_percent REAL,
                    message TEXT,
                    severity TEXT,
                    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    acknowledged BOOLEAN DEFAULT 0
                )
            ''')
            
            # Alert state tracking (to prevent spam)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS alert_state (
                    symbol TEXT PRIMARY KEY,
                    last_alert_price REAL,
                    last_alert_time TIMESTAMP,
                    alert_count_today INTEGER DEFAULT 0
                )
            ''')
            
            conn.commit()
            logger.info("Alert tables ensured")
    
    def get_default_thresholds(self) -> Dict[str, float]:
        """Default alert thresholds"""
        return {
            'portfolio_drop_percent': 5.0,      # Alert if portfolio drops 5%
            'portfolio_gain_percent': 10.0,     # Alert if portfolio gains 10%
            'holding_drop_percent': 8.0,        # Alert if any holding drops 8%
            'holding_gain_percent': 15.0,       # Alert if any holding gains 15%
            'crypto_volatility_percent': 12.0,  # Crypto is more volatile
            'daily_alert_limit': 3,             # Max alerts per symbol per day
        }
    
    def check_portfolio_alerts(self) -> List[PriceAlert]:
        """Check for portfolio-level alerts"""
        alerts = []
        thresholds = self.get_default_thresholds()
        
        with self.get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Get current portfolio summary
            cursor.execute('''
                SELECT 
                    SUM(current_price * shares) as total_value,
                    SUM(cost_basis_per_share * shares) as total_cost,
                    COUNT(*) as holdings_count
                FROM holdings
                WHERE shares > 0
            ''')
            row = cursor.fetchone()
            
            if not row or not row['total_value']:
                return alerts
            
            total_value = row['total_value']
            total_cost = row['total_cost']
            total_gain_loss_pct = ((total_value - total_cost) / total_cost * 100) if total_cost else 0
            
            # Check portfolio drop
            if total_gain_loss_pct <= -thresholds['portfolio_drop_percent']:
                alerts.append(PriceAlert(
                    symbol='PORTFOLIO',
                    alert_type='loss',
                    current_price=total_value,
                    previous_price=total_cost,
                    change_percent=total_gain_loss_pct,
                    message=f"Portfolio down {abs(total_gain_loss_pct):.1f}% (${total_value - total_cost:,.0f})",
                    severity='critical' if total_gain_loss_pct <= -10 else 'warning'
                ))
            
            # Check portfolio gain
            elif total_gain_loss_pct >= thresholds['portfolio_gain_percent']:
                alerts.append(PriceAlert(
                    symbol='PORTFOLIO',
                    alert_type='gain',
                    current_price=total_value,
                    previous_price=total_cost,
                    change_percent=total_gain_loss_pct,
                    message=f"Portfolio up {total_gain_loss_pct:.1f}% (+${total_value - total_cost:,.0f})",
                    severity='info'
                ))
        
        return alerts
    
    def check_holding_alerts(self) -> List[PriceAlert]:
        """Check individual holding alerts"""
        alerts = []
        thresholds = self.get_default_thresholds()
        
        with self.get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Get all holdings with price history
            cursor.execute('''
                SELECT 
                    h.symbol,
                    h.asset_name,
                    h.asset_class,
                    h.current_price,
                    h.cost_basis_per_share,
                    h.shares,
                    ph.price as previous_price,
                    ph.recorded_at as previous_time
                FROM holdings h
                LEFT JOIN (
                    SELECT symbol, price, recorded_at,
                           ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY recorded_at DESC) as rn
                    FROM price_history
                    WHERE recorded_at >= datetime('now', '-7 days')
                ) ph ON h.symbol = ph.symbol AND ph.rn = 2
                WHERE h.shares > 0 AND h.current_price IS NOT NULL
            ''')
            
            for row in cursor.fetchall():
                symbol = row['symbol']
                current = row['current_price']
                cost_basis = row['cost_basis_per_share']
                asset_class = row['asset_class']
                
                # Calculate change from cost basis
                if cost_basis and cost_basis > 0:
                    change_pct = ((current - cost_basis) / cost_basis) * 100
                else:
                    change_pct = 0
                
                # Determine threshold based on asset class
                drop_threshold = thresholds['crypto_volatility_percent'] if asset_class == 'crypto' else thresholds['holding_drop_percent']
                gain_threshold = thresholds['crypto_volatility_percent'] if asset_class == 'crypto' else thresholds['holding_gain_percent']
                
                # Check for significant drop
                if change_pct <= -drop_threshold:
                    if not self._recently_alerted(symbol, 'loss'):
                        alerts.append(PriceAlert(
                            symbol=symbol,
                            alert_type='loss',
                            current_price=current,
                            previous_price=cost_basis,
                            change_percent=change_pct,
                            message=f"{symbol} down {abs(change_pct):.1f}% from cost basis (${current:.2f} vs ${cost_basis:.2f})",
                            severity='warning' if change_pct > -15 else 'critical'
                        ))
                        self._record_alert_sent(symbol, current, 'loss')
                
                # Check for significant gain
                elif change_pct >= gain_threshold:
                    if not self._recently_alerted(symbol, 'gain'):
                        alerts.append(PriceAlert(
                            symbol=symbol,
                            alert_type='gain',
                            current_price=current,
                            previous_price=cost_basis,
                            change_percent=change_pct,
                            message=f"{symbol} up {change_pct:.1f}% from cost basis (${current:.2f} vs ${cost_basis:.2f})",
                            severity='info'
                        ))
                        self._record_alert_sent(symbol, current, 'gain')
        
        return alerts
    
    def _recently_alerted(self, symbol: str, alert_type: str) -> bool:
        """Check if we recently sent this alert type (prevent spam)"""
        with self.get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Check if alert sent in last 6 hours (increased from 4 to reduce spam)
            cursor.execute('''
                SELECT COUNT(*) FROM price_alerts
                WHERE symbol = ? AND alert_type = ?
                AND sent_at >= datetime('now', '-6 hours')
            ''', (symbol, alert_type))
            
            count = cursor.fetchone()[0]
            
            # Also check daily limit (reduced to 2 per day per symbol)
            cursor.execute('''
                SELECT COUNT(*) FROM price_alerts
                WHERE symbol = ? AND DATE(sent_at) = DATE('now')
            ''', (symbol,))
            
            daily_count = cursor.fetchone()[0]
            
            return count > 0 or daily_count >= 2
    
    def _record_alert_sent(self, symbol: str, price: float, alert_type: str):
        """Record that we sent an alert"""
        with self.get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT OR REPLACE INTO alert_state (symbol, last_alert_price, last_alert_time, alert_count_today)
                VALUES (?, ?, CURRENT_TIMESTAMP, 
                    COALESCE((SELECT alert_count_today FROM alert_state WHERE symbol = ?), 0) + 1
                )
            ''', (symbol, price, symbol))
            conn.commit()
    
    def save_alert(self, alert: PriceAlert):
        """Save alert to database"""
        with self.get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO price_alerts (symbol, alert_type, current_price, previous_price, change_percent, message, severity)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (alert.symbol, alert.alert_type, alert.current_price, alert.previous_price,
                  alert.change_percent, alert.message, alert.severity))
            conn.commit()
    
    def send_telegram_alert(self, alert: PriceAlert) -> bool:
        """Send alert via Telegram"""
        try:
            import urllib.request
            import urllib.parse
            
            # Emoji based on severity
            emoji_map = {
                'critical': '🚨',
                'warning': '⚠️',
                'info': 'ℹ️'
            }
            emoji = emoji_map.get(alert.severity, '📊')
            
            # Direction indicator
            direction = '📈' if alert.change_percent > 0 else '📉'
            
            message = f"""{emoji} **WealthGuard Alert**

{direction} {alert.message}

**Symbol:** {alert.symbol}
**Current:** ${alert.current_price:,.2f}
**Change:** {alert.change_percent:+.1f}%
**Severity:** {alert.severity.upper()}

{datetime.now().strftime('%Y-%m-%d %H:%M')}"""

            url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
            data = urllib.parse.urlencode({
                'chat_id': TELEGRAM_CHAT_ID,
                'text': message,
                'parse_mode': 'Markdown'
            }).encode()
            
            req = urllib.request.Request(url, data=data, method='POST')
            with urllib.request.urlopen(req, timeout=30) as response:
                result = json.loads(response.read().decode())
                return result.get('ok', False)
                
        except Exception as e:
            logger.error(f"Error sending Telegram alert: {e}")
            return False
    
    def run_alert_check(self) -> Dict:
        """Run full alert check and send notifications"""
        self.ensure_tables()
        
        # Check if it's appropriate time to send alerts (8 AM - 10 PM Brisbane)
        brisbane_hour = datetime.now().astimezone().hour
        if brisbane_hour < 8 or brisbane_hour > 22:
            logger.info(f"Skipping alert check - outside notification hours (8 AM - 10 PM)")
            return {
                'alerts_found': 0,
                'alerts_sent': 0,
                'skipped': 'outside_hours',
                'alerts': []
            }
        
        all_alerts = []
        
        # Check portfolio-level alerts
        portfolio_alerts = self.check_portfolio_alerts()
        all_alerts.extend(portfolio_alerts)
        
        # Check individual holdings
        holding_alerts = self.check_holding_alerts()
        all_alerts.extend(holding_alerts)
        
        # Limit total alerts per run to prevent spam
        if len(all_alerts) > 5:
            logger.warning(f"Too many alerts ({len(all_alerts)}), limiting to top 5 most critical")
            # Sort by severity and take top 5
            severity_order = {'critical': 0, 'warning': 1, 'info': 2}
            all_alerts.sort(key=lambda a: severity_order.get(a.severity, 3))
            all_alerts = all_alerts[:5]
        
        # Save and send alerts
        sent_count = 0
        for alert in all_alerts:
            self.save_alert(alert)
            if self.send_telegram_alert(alert):
                sent_count += 1
                logger.info(f"Alert sent: {alert.message}")
            else:
                logger.warning(f"Failed to send alert: {alert.message}")
        
        return {
            'alerts_found': len(all_alerts),
            'alerts_sent': sent_count,
            'alerts': [{**a.__dict__, 'sent': True} for a in all_alerts]
        }
    
    def get_recent_alerts(self, hours: int = 24) -> List[Dict]:
        """Get recent alerts"""
        with self.get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM price_alerts
                WHERE sent_at >= datetime('now', ?)
                ORDER BY sent_at DESC
            ''', (f'-{hours} hours',))
            return [dict(row) for row in cursor.fetchall()]


def main():
    """Run alert check from CLI"""
    import sys
    
    manager = AlertManager()
    
    if len(sys.argv) > 1:
        if sys.argv[1] == '--recent':
            hours = int(sys.argv[2]) if len(sys.argv) > 2 else 24
            alerts = manager.get_recent_alerts(hours)
            print(f"Recent alerts (last {hours} hours):")
            for a in alerts:
                print(f"  [{a['severity']}] {a['symbol']}: {a['message']}")
        elif sys.argv[1] == '--test':
            # Send test alert
            test_alert = PriceAlert(
                symbol='TEST',
                alert_type='gain',
                current_price=100.0,
                previous_price=90.0,
                change_percent=11.1,
                message='Test alert from WealthGuard',
                severity='info'
            )
            manager.ensure_tables()
            manager.save_alert(test_alert)
            if manager.send_telegram_alert(test_alert):
                print("✓ Test alert sent successfully")
            else:
                print("✗ Failed to send test alert")
    else:
        # Run alert check
        result = manager.run_alert_check()
        print(f"Alert check complete: {result['alerts_found']} found, {result['alerts_sent']} sent")


if __name__ == '__main__':
    main()
