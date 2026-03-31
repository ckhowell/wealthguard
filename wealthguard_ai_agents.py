#!/usr/bin/env python3
"""
WealthGuard AI Market Intelligence Module
Implements neural search and news aggregation for portfolio monitoring
"""
import sqlite3
import json
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import re

DB_PATH = "/root/.openclaw/workspace/wealthguard.db"

class MarketIntelligenceAgent:
    """
    Specialized agent for market intelligence and news monitoring
    """
    
    def __init__(self):
        self.conn = sqlite3.connect(DB_PATH)
        self.conn.row_factory = sqlite3.Row
        
    def get_portfolio_symbols(self) -> List[str]:
        """Get all tracked symbols from holdings"""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT DISTINCT symbol, asset_name 
            FROM holdings 
            WHERE asset_class IN ('crypto', 'equity') AND shares > 0
        """)
        return [row['symbol'] for row in cursor.fetchall()]
    
    def get_portfolio_sectors(self) -> List[str]:
        """Get sectors/industries from holdings"""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT DISTINCT sector 
            FROM holdings 
            WHERE sector IS NOT NULL
        """)
        return [row['sector'] for row in cursor.fetchall() if row['sector']]
    
    def generate_news_query(self) -> str:
        """Generate search query based on portfolio holdings"""
        symbols = self.get_portfolio_symbols()
        sectors = self.get_portfolio_sectors()
        
        # Build query from holdings
        query_parts = []
        
        # Add major holdings
        if 'NVDA' in symbols:
            query_parts.extend(['NVIDIA', 'AI chips', 'semiconductor'])
        if 'AAPL' in symbols:
            query_parts.extend(['Apple', 'iPhone', 'tech earnings'])
        if 'GOOGL' in symbols:
            query_parts.extend(['Google', 'Alphabet', 'AI search'])
        if 'BTC' in symbols or any('BTC' in s for s in symbols):
            query_parts.extend(['Bitcoin', 'crypto regulation', 'BTC price'])
        if 'ETH' in symbols or any('ETH' in s for s in symbols):
            query_parts.extend(['Ethereum', 'ETH', 'DeFi'])
            
        # Add sector keywords
        if 'real_estate' in sectors or any('property' in str(s).lower() for s in sectors):
            query_parts.extend(['real estate', 'property market', 'interest rates'])
        
        # Add general market terms
        query_parts.extend(['ASX', 'Australian dollar', 'AUD/USD', 'RBA'])
        
        return ' OR '.join(query_parts[:10])  # Limit query length
    
    def fetch_market_news(self, days: int = 1) -> List[Dict]:
        """
        Fetch relevant market news (mock implementation)
        In production, this would connect to news APIs (Reuters, WSJ, etc.)
        """
        symbols = self.get_portfolio_symbols()
        
        # Mock news items - in production would come from actual APIs
        news_items = []
        
        if 'NVDA' in symbols:
            news_items.append({
                'headline': 'NVIDIA Reports Record Data Center Revenue Amid AI Demand Surge',
                'source': 'Reuters',
                'date': datetime.now().isoformat(),
                'summary': 'NVIDIA beat earnings expectations with $22.1B in data center revenue, driven by AI chip demand.',
                'relevance_score': 0.95,
                'tickers': ['NVDA'],
                'impact': 'positive'
            })
        
        if any('BTC' in s for s in symbols):
            news_items.append({
                'headline': 'Bitcoin Surges Past $70K as ETF Inflows Accelerate',
                'source': 'Bloomberg',
                'date': datetime.now().isoformat(),
                'summary': 'Bitcoin reached new highs driven by institutional adoption through ETFs.',
                'relevance_score': 0.92,
                'tickers': ['BTC'],
                'impact': 'positive'
            })
            
        news_items.append({
            'headline': 'RBA Holds Rates Steady at 4.35% Amid Inflation Concerns',
            'source': 'AFR',
            'date': datetime.now().isoformat(),
            'summary': 'Reserve Bank maintains cash rate, citing sticky inflation in services sector.',
            'relevance_score': 0.88,
            'tickers': ['AUD', 'RBA'],
            'impact': 'neutral'
        })
        
        # Add real estate news for property holders
        cursor = self.conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM holdings WHERE asset_class = 'alternative'")
        if cursor.fetchone()[0] > 0:
            news_items.append({
                'headline': 'Australian Property Prices Continue Upward Trend in Q1 2026',
                'source': 'CoreLogic',
                'date': datetime.now().isoformat(),
                'summary': 'National home values rose 0.8% in March, with Brisbane and Perth leading gains.',
                'relevance_score': 0.85,
                'tickers': ['Property'],
                'impact': 'positive'
            })
        
        return news_items
    
    def analyze_portfolio_impact(self, news_item: Dict) -> Dict:
        """Analyze how a news item might impact the portfolio"""
        cursor = self.conn.cursor()
        
        impact_analysis = {
            'news_item': news_item,
            'affected_holdings': [],
            'estimated_impact': 'neutral',
            'action_recommended': None
        }
        
        # Check which holdings are affected
        for ticker in news_item.get('tickers', []):
            cursor.execute("""
                SELECT symbol, asset_name, shares, current_price, 
                       (shares * current_price) as value
                FROM holdings 
                WHERE symbol LIKE ? OR asset_name LIKE ?
            """, (f'%{ticker}%', f'%{ticker}%'))
            
            for row in cursor.fetchall():
                impact_analysis['affected_holdings'].append({
                    'symbol': row['symbol'],
                    'name': row['asset_name'],
                    'value': row['value']
                })
        
        # Determine impact severity based on holding size
        total_affected = sum(h['value'] for h in impact_analysis['affected_holdings'])
        if total_affected > 100000:
            impact_analysis['estimated_impact'] = 'high'
        elif total_affected > 10000:
            impact_analysis['estimated_impact'] = 'medium'
        else:
            impact_analysis['estimated_impact'] = 'low'
        
        # Generate recommendation
        if news_item.get('impact') == 'positive' and impact_analysis['estimated_impact'] == 'high':
            impact_analysis['action_recommended'] = 'Monitor for profit-taking opportunity'
        elif news_item.get('impact') == 'negative' and impact_analysis['estimated_impact'] == 'high':
            impact_analysis['action_recommended'] = 'Consider hedging or position review'
        
        return impact_analysis
    
    def generate_daily_briefing(self) -> str:
        """Generate a daily portfolio briefing"""
        news = self.fetch_market_news()
        
        briefing_lines = []
        briefing_lines.append("=" * 70)
        briefing_lines.append("📰 WEALTHGUARD DAILY MARKET BRIEFING")
        briefing_lines.append("=" * 70)
        briefing_lines.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        briefing_lines.append("")
        
        # Portfolio overview
        cursor = self.conn.cursor()
        cursor.execute("SELECT SUM(shares * current_price) FROM holdings")
        portfolio_value = cursor.fetchone()[0] or 0
        
        briefing_lines.append(f"💰 Portfolio Value: AUD ${portfolio_value:,.2f}")
        briefing_lines.append("")
        
        # News items with impact analysis
        briefing_lines.append("📊 RELEVANT NEWS:")
        briefing_lines.append("-" * 70)
        
        for item in news:
            impact = self.analyze_portfolio_impact(item)
            relevance = "🔴" if item.get('relevance_score', 0) > 0.9 else "🟠" if item.get('relevance_score', 0) > 0.7 else "🟢"
            
            briefing_lines.append(f"{relevance} {item['headline']}")
            briefing_lines.append(f"   Source: {item['source']} | Relevance: {item.get('relevance_score', 0):.0%}")
            briefing_lines.append(f"   {item['summary']}")
            
            if impact['affected_holdings']:
                briefing_lines.append(f"   💼 Affected: {', '.join(h['symbol'] for h in impact['affected_holdings'])}")
            
            if impact['action_recommended']:
                briefing_lines.append(f"   ⚡ Action: {impact['action_recommended']}")
            
            briefing_lines.append("")
        
        briefing_lines.append("=" * 70)
        return "\n".join(briefing_lines)
    
    def close(self):
        self.conn.close()


class PredictiveAnalyticsAgent:
    """
    Agent for predictive analytics and forecasting
    """
    
    def __init__(self):
        self.conn = sqlite3.connect(DB_PATH)
        self.conn.row_factory = sqlite3.Row
    
    def forecast_spending(self, months_ahead: int = 3) -> Dict:
        """Forecast spending based on historical patterns"""
        cursor = self.conn.cursor()
        
        # Get historical spending by category
        cursor.execute("""
            SELECT 
                category,
                AVG(monthly_spend) as avg_spend,
                COUNT(*) as months_data
            FROM (
                SELECT 
                    category,
                    strftime('%Y-%m', transaction_date) as month,
                    SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as monthly_spend
                FROM transactions
                WHERE transaction_date >= date('now', '-12 months')
                  AND category IS NOT NULL
                GROUP BY category, strftime('%Y-%m', transaction_date)
            )
            GROUP BY category
        """)
        
        forecasts = {}
        for row in cursor.fetchall():
            forecasts[row['category']] = {
                'average_monthly': row['avg_spend'],
                'forecast_3m': row['avg_spend'] * 3,
                'confidence': min(row['months_data'] / 12, 1.0)
            }
        
        return forecasts
    
    def budget_overrun_warning(self) -> List[Dict]:
        """Identify budgets at risk of overrun"""
        cursor = self.conn.cursor()
        
        cursor.execute("""
            SELECT 
                b.category,
                b.budget_amount,
                COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0) as spent,
                strftime('%d', 'now') as day_of_month,
                strftime('%d', date('now', 'start of month', '+1 month', '-1 day')) as days_in_month
            FROM budgets b
            LEFT JOIN transactions t ON 
                b.category = t.category 
                AND strftime('%Y-%m', t.transaction_date) = strftime('%Y-%m', 'now')
            GROUP BY b.category
        """)
        
        warnings = []
        for row in cursor.fetchall():
            budget = row['budget_amount']
            spent = row['spent']
            day = int(row['day_of_month'])
            days_total = int(row['days_in_month'])
            
            if budget <= 0:
                continue
                
            pct_spent = spent / budget
            pct_time = day / days_total
            
            # If spending faster than time passing
            if pct_spent > pct_time * 1.2:  # 20% buffer
                projected = (spent / day) * days_total
                warnings.append({
                    'category': row['category'],
                    'budget': budget,
                    'spent': spent,
                    'projected_monthly': projected,
                    'risk_level': 'high' if pct_spent > 0.9 else 'medium' if pct_spent > 0.75 else 'low'
                })
        
        return warnings
    
    def close(self):
        self.conn.close()


class GeopoliticalMonitorAgent:
    """
    Agent for monitoring geopolitical events and market impact
    """
    
    def __init__(self):
        self.conn = sqlite3.connect(DB_PATH)
        self.conn.row_factory = sqlite3.Row
    
    def check_market_events(self) -> List[Dict]:
        """Check for significant market-moving events"""
        events = []
        
        # Mock events - in production would monitor actual sources
        events.append({
            'type': 'central_bank',
            'event': 'RBA Policy Meeting',
            'date': datetime.now() + timedelta(days=7),
            'potential_impact': 'medium',
            'affected_assets': ['AUD', 'Australian equities', 'Property'],
            'description': 'Next RBA policy decision on interest rates'
        })
        
        # Check for crypto-related events if user holds crypto
        cursor = self.conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM holdings WHERE asset_class = 'crypto'")
        if cursor.fetchone()[0] > 0:
            events.append({
                'type': 'regulatory',
                'event': 'SEC ETF Decision Pending',
                'date': datetime.now() + timedelta(days=14),
                'potential_impact': 'high',
                'affected_assets': ['BTC', 'ETH', 'Crypto'],
                'description': 'Potential approval of additional crypto ETFs'
            })
        
        return events
    
    def close(self):
        self.conn.close()


# Convenience functions
def generate_daily_briefing():
    """Generate and return daily market briefing"""
    agent = MarketIntelligenceAgent()
    try:
        briefing = agent.generate_daily_briefing()
        return briefing
    finally:
        agent.close()

def get_budget_warnings():
    """Get budget overrun warnings"""
    agent = PredictiveAnalyticsAgent()
    try:
        return agent.budget_overrun_warning()
    finally:
        agent.close()

def get_upcoming_events():
    """Get upcoming market events"""
    agent = GeopoliticalMonitorAgent()
    try:
        return agent.check_market_events()
    finally:
        agent.close()

if __name__ == "__main__":
    print(generate_daily_briefing())
    print("\n" + "="*70)
    print("BUDGET WARNINGS:")
    for warning in get_budget_warnings():
        print(f"  ⚠️ {warning['category']}: Projected ${warning['projected_monthly']:.0f} vs ${warning['budget']:.0f} budget")
