#!/usr/bin/env python3
"""
WealthGuard System Health Monitor
Tracks and reports on all system components
"""

import os
import sys
import json
import sqlite3
import subprocess
from datetime import datetime, timedelta
from typing import Dict, List, Optional

sys.path.insert(0, '/root/.openclaw/workspace')

DB_PATH = os.getenv('DATABASE_PATH', '/root/.openclaw/workspace/wealthguard.db')

def check_api_health() -> Dict:
    """Check backend API status"""
    try:
        import urllib.request
        req = urllib.request.Request('http://localhost:8000/')
        with urllib.request.urlopen(req, timeout=5) as resp:
            return {
                'status': 'healthy' if resp.status == 200 else 'degraded',
                'http_code': resp.status,
                'response_time_ms': 0  # Could add timing
            }
    except Exception as e:
        return {
            'status': 'down',
            'error': str(e),
            'http_code': None
        }

def check_frontend_health() -> Dict:
    """Check frontend dev server status"""
    try:
        import urllib.request
        req = urllib.request.Request('http://localhost:5173/')
        with urllib.request.urlopen(req, timeout=5) as resp:
            return {
                'status': 'healthy' if resp.status == 200 else 'degraded',
                'http_code': resp.status
            }
    except Exception as e:
        return {
            'status': 'down',
            'error': str(e)
        }

def check_cloudflare_tunnel() -> Dict:
    """Check Cloudflare tunnel status"""
    try:
        # Check if cloudflare process is running
        result = subprocess.run(
            ['pgrep', '-f', 'cloudflare'],
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            # Get tunnel URL from log
            url = None
            if os.path.exists('/tmp/cloudflare.log'):
                with open('/tmp/cloudflare.log') as f:
                    for line in f:
                        if 'trycloudflare.com' in line:
                            import re
                            match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
                            if match:
                                url = match.group(0)
                                break
            
            return {
                'status': 'healthy',
                'url': url,
                'pid': result.stdout.strip()
            }
        else:
            return {
                'status': 'down',
                'error': 'Cloudflare process not found'
            }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e)
        }

def check_price_sync_status() -> Dict:
    """Check when prices were last synced"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Get latest sync run
        cursor.execute('''
            SELECT * FROM sync_runs
            ORDER BY started_at DESC
            LIMIT 1
        ''')
        row = cursor.fetchone()
        
        if not row:
            return {'status': 'never_run', 'message': 'No sync runs recorded'}
        
        # Parse columns
        columns = [description[0] for description in cursor.description]
        sync_data = dict(zip(columns, row))
        
        # Check if sync is stale (>30 min old)
        completed = sync_data.get('completed_at')
        if completed:
            completed_time = datetime.fromisoformat(completed.replace('Z', '+00:00').replace('+00:00', ''))
            age_minutes = (datetime.now() - completed_time).total_seconds() / 60
            
            return {
                'status': 'current' if age_minutes < 30 else 'stale',
                'last_sync': completed,
                'age_minutes': round(age_minutes, 1),
                'success_count': sync_data.get('success_count', 0),
                'fail_count': sync_data.get('fail_count', 0),
                'status_text': sync_data.get('status', 'unknown')
            }
        
        return {'status': 'incomplete', 'message': 'Sync started but not completed'}
        
    except Exception as e:
        return {'status': 'error', 'error': str(e)}
    finally:
        conn.close()

def check_database_status() -> Dict:
    """Check database health"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Check tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [r[0] for r in cursor.fetchall()]
        
        # Check holdings count
        cursor.execute("SELECT COUNT(*) FROM holdings")
        holdings_count = cursor.fetchone()[0]
        
        # Check last price update
        cursor.execute('''
            SELECT MAX(last_price_update) FROM holdings
            WHERE last_price_update IS NOT NULL
        ''')
        last_update = cursor.fetchone()[0]
        
        conn.close()
        
        return {
            'status': 'healthy',
            'tables': len(tables),
            'holdings': holdings_count,
            'last_price_update': last_update
        }
        
    except Exception as e:
        return {'status': 'error', 'error': str(e)}

def get_system_health() -> Dict:
    """Get complete system health report"""
    return {
        'timestamp': datetime.now().isoformat(),
        'components': {
            'api': check_api_health(),
            'frontend': check_frontend_health(),
            'cloudflare': check_cloudflare_tunnel(),
            'price_sync': check_price_sync_status(),
            'database': check_database_status()
        }
    }

def print_health_report():
    """Print formatted health report"""
    health = get_system_health()
    
    print("=" * 60)
    print(f"WEALTHGUARD SYSTEM HEALTH - {health['timestamp'][:19]}")
    print("=" * 60)
    
    # API
    api = health['components']['api']
    api_icon = "✓" if api['status'] == 'healthy' else "✗"
    print(f"\n{api_icon} Backend API: {api['status'].upper()}")
    if api.get('http_code'):
        print(f"   HTTP {api['http_code']}")
    
    # Frontend
    fe = health['components']['frontend']
    fe_icon = "✓" if fe['status'] == 'healthy' else "✗"
    print(f"\n{fe_icon} Frontend: {fe['status'].upper()}")
    
    # Cloudflare
    cf = health['components']['cloudflare']
    cf_icon = "✓" if cf['status'] == 'healthy' else "✗"
    print(f"\n{cf_icon} Cloudflare Tunnel: {cf['status'].upper()}")
    if cf.get('url'):
        print(f"   URL: {cf['url']}")
    
    # Price Sync
    ps = health['components']['price_sync']
    ps_icon = "✓" if ps['status'] in ['current', 'healthy'] else "⚠" if ps['status'] == 'stale' else "✗"
    print(f"\n{ps_icon} Price Sync: {ps['status'].upper()}")
    if ps.get('last_sync'):
        print(f"   Last: {ps['last_sync'][:19]} ({ps.get('age_minutes', 0):.0f} min ago)")
        print(f"   Success: {ps.get('success_count', 0)}/{ps.get('success_count', 0) + ps.get('fail_count', 0)}")
    
    # Database
    db = health['components']['database']
    db_icon = "✓" if db['status'] == 'healthy' else "✗"
    print(f"\n{db_icon} Database: {db['status'].upper()}")
    print(f"   Tables: {db.get('tables', 0)} | Holdings: {db.get('holdings', 0)}")
    
    print("\n" + "=" * 60)

if __name__ == '__main__':
    print_health_report()
