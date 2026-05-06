"""
WealthGuard Intelligence Engine
Aggregates news, sentiment, geopolitical risk, and alternative data
"""
import os
import requests
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from dotenv import load_dotenv

load_dotenv()

class NewsIntelligence:
    """News aggregation and sentiment analysis"""
    
    def __init__(self):
        self.newsapi_key = os.getenv('NEWSAPI_KEY')
        self.gnews_key = os.getenv('GNEWS_KEY', '')
        
    def get_financial_news(self, query: str = None, days: int = 1) -> List[Dict]:
        """Get financial news from multiple sources"""
        articles = []
        
        # NewsAPI.ai (Event Registry)
        if self.newsapi_key:
            try:
                url = "https://eventregistry.org/api/v1/article/getArticles"
                params = {
                    'action': 'getArticles',
                    'keyword': query or 'finance OR stock OR market',
                    'articlesPage': 1,
                    'articlesCount': 10,
                    'articleBodyLen': 200,
                    'apiKey': self.newsapi_key,
                    'dateStart': (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
                }
                resp = requests.get(url, params=params, timeout=30)
                if resp.status_code == 200:
                    data = resp.json()
                    if 'articles' in data and 'results' in data['articles']:
                        for art in data['articles']['results']:
                            articles.append({
                                'title': art.get('title'),
                                'source': art.get('source', {}).get('title'),
                                'date': art.get('date'),
                                'url': art.get('url'),
                                'sentiment': art.get('sentiment'),
                                'body': art.get('body', '')[:500]
                            })
            except Exception as e:
                print(f"NewsAPI error: {e}")
        
        # GNews backup
        if not articles and self.gnews_key:
            try:
                url = "https://gnews.io/api/v4/search"
                params = {
                    'q': query or 'finance stock market',
                    'token': self.gnews_key,
                    'max': 10,
                    'from': (datetime.now() - timedelta(days=days)).isoformat()
                }
                resp = requests.get(url, params=params, timeout=30)
                if resp.status_code == 200:
                    data = resp.json()
                    for art in data.get('articles', []):
                        articles.append({
                            'title': art.get('title'),
                            'source': art.get('source', {}).get('name'),
                            'date': art.get('publishedAt'),
                            'url': art.get('url'),
                            'sentiment': None,
                            'body': art.get('content', '')[:500]
                        })
            except Exception as e:
                print(f"GNews error: {e}")
        
        return articles
    
    def get_ticker_news(self, ticker: str) -> List[Dict]:
        """Get news for specific ticker"""
        return self.get_financial_news(query=ticker, days=7)


class GeopoliticalRiskMonitor:
    """Monitor geopolitical events and risk scores"""
    
    def __init__(self):
        self.cache = {}
        self.cache_time = None
    
    def get_global_risk_events(self) -> List[Dict]:
        """Get recent geopolitical events from GDELT"""
        try:
            # GDELT Global Knowledge Graph
            # This is a simplified version - full GDELT requires BigQuery
            url = "https://api.gdeltproject.org/api/v2/geo/geo"
            params = {
                'query': 'conflict OR sanctions OR trade war',
                'mode': 'ArtList',
                'maxrecords': 20,
                'format': 'json'
            }
            resp = requests.get(url, params=params, timeout=30)
            if resp.status_code == 200:
                return resp.json().get('articles', [])
        except Exception as e:
            print(f"GDELT error: {e}")
        return []
    
    def get_country_risk(self, country: str) -> Dict:
        """Get risk score for a country"""
        # Simplified - would integrate with GeoQuant or similar
        risk_factors = {
            'china': ['trade_war', 'taiwan_tensions', 'property_crisis'],
            'russia': ['ukraine_war', 'sanctions', 'energy_disruption'],
            'usa': ['election_risk', 'debt_ceiling', 'fed_policy'],
        }
        return {
            'country': country,
            'risk_factors': risk_factors.get(country.lower(), []),
            'overall_score': 'medium'  # Would be calculated
        }


class AlternativeDataFeed:
    """Alternative data sources"""
    
    def get_google_trends(self, keyword: str) -> Optional[Dict]:
        """Get Google Trends data (requires pytrends)"""
        try:
            from pytrends.request import TrendReq
            pytrends = TrendReq(hl='en-US', tz=360)
            pytrends.build_payload([keyword], cat=0, timeframe='today 3-m')
            data = pytrends.interest_over_time()
            if not data.empty:
                return {
                    'keyword': keyword,
                    'current_interest': int(data[keyword].iloc[-1]),
                    'trend': 'up' if data[keyword].iloc[-1] > data[keyword].iloc[-7] else 'down'
                }
        except ImportError:
            print("pytrends not installed. Run: pip install pytrends")
        except Exception as e:
            print(f"Trends error: {e}")
        return None
    
    def get_sec_insider_trades(self, ticker: str) -> List[Dict]:
        """Get insider trading from SEC EDGAR"""
        try:
            # SEC EDGAR API for Form 4 filings
            url = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=4&CIK={ticker}&output=json"
            headers = {'User-Agent': 'WealthGuard Bot contact@wealthguard.local'}
            resp = requests.get(url, headers=headers, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                trades = []
                for filing in data.get('filings', {}).get('recent', {}).get('accessionNumber', [])[:5]:
                    trades.append({'accession': filing, 'type': 'insider_trade'})
                return trades
        except Exception as e:
            print(f"SEC error: {e}")
        return []


class SwarmDataAggregator:
    """Aggregate retail investor sentiment and activity"""
    
    def __init__(self):
        self.stocktwits_token = os.getenv('STOCKTWITS_TOKEN', '')
    
    def get_stocktwits_sentiment(self, ticker: str) -> Optional[Dict]:
        """Get StockTwits sentiment for ticker"""
        try:
            url = f"https://api.stocktwits.com/api/2/streams/symbol/{ticker}.json"
            headers = {}
            if self.stocktwits_token:
                headers['Authorization'] = f'OAuth {self.stocktwits_token}'
            
            resp = requests.get(url, headers=headers, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                messages = data.get('messages', [])
                
                # Simple sentiment calculation
                bullish = sum(1 for m in messages if m.get('entities', {}).get('sentiment') == 'Bullish')
                bearish = sum(1 for m in messages if m.get('entities', {}).get('sentiment') == 'Bearish')
                total = len(messages)
                
                return {
                    'ticker': ticker,
                    'sentiment_score': (bullish - bearish) / total if total > 0 else 0,
                    'bullish_pct': (bullish / total * 100) if total > 0 else 50,
                    'message_count': total,
                    'recent_messages': [m.get('body', '')[:100] for m in messages[:3]]
                }
        except Exception as e:
            print(f"StockTwits error: {e}")
        return None
    
    def get_fear_greed_index(self) -> Dict:
        """Calculate fear/greed from multiple sources"""
        # CNN Fear & Greed scraper
        try:
            url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
            resp = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                return {
                    'index': data.get('fear_and_greed', {}).get('score'),
                    'rating': data.get('fear_and_greed', {}).get('rating'),
                    'previous_close': data.get('fear_and_greed', {}).get('previous_close')
                }
        except Exception as e:
            print(f"Fear/Greed error: {e}")
        
        return {'index': 50, 'rating': 'neutral', 'source': 'fallback'}


class IntelligenceEngine:
    """Main intelligence engine that aggregates all sources"""
    
    def __init__(self):
        self.news = NewsIntelligence()
        self.geo = GeopoliticalRiskMonitor()
        self.alternative = AlternativeDataFeed()
        self.swarm = SwarmDataAggregator()
    
    def generate_portfolio_signals(self, portfolio: List[Dict]) -> List[Dict]:
        """Generate signals for entire portfolio"""
        signals = []
        
        for holding in portfolio:
            ticker = holding.get('symbol', '')
            asset_class = holding.get('asset_class', '')
            
            # Skip if no ticker
            if not ticker:
                continue
            
            # News sentiment signal
            news = self.news.get_ticker_news(ticker)
            negative_news = [n for n in news if n.get('sentiment') and n['sentiment'] < -0.3]
            if len(negative_news) >= 2:
                signals.append({
                    'type': 'news_alert',
                    'symbol': ticker,
                    'action': 'review',
                    'reason': f"Multiple negative news items: {negative_news[0]['title'][:80]}...",
                    'severity': 'medium'
                })
            
            # Swarm sentiment for stocks/crypto
            if asset_class in ['equity', 'crypto']:
                swarm = self.swarm.get_stocktwits_sentiment(ticker)
                if swarm and abs(swarm['sentiment_score']) > 0.5:
                    direction = 'bullish' if swarm['sentiment_score'] > 0 else 'bearish'
                    signals.append({
                        'type': 'swarm_sentiment',
                        'symbol': ticker,
                        'action': 'note',
                        'reason': f"StockTwits heavily {direction}: {swarm['bullish_pct']:.0f}% bullish",
                        'severity': 'low'
                    })
        
        # Fear/greed for overall market
        fng = self.swarm.get_fear_greed_index()
        if fng.get('index', 50) < 20:
            signals.append({
                'type': 'market_sentiment',
                'symbol': 'MARKET',
                'action': 'consider_buy',
                'reason': f"Extreme fear in markets (Fear/Greed: {fng['index']})",
                'severity': 'high'
            })
        elif fng.get('index', 50) > 80:
            signals.append({
                'type': 'market_sentiment',
                'symbol': 'MARKET',
                'action': 'consider_trim',
                'reason': f"Extreme greed in markets (Fear/Greed: {fng['index']})",
                'severity': 'medium'
            })
        
        return signals
    
    def get_daily_briefing(self) -> Dict:
        """Get daily intelligence briefing"""
        return {
            'date': datetime.now().isoformat(),
            'fear_greed': self.swarm.get_fear_greed_index(),
            'top_news': self.news.get_financial_news(days=1)[:3],
            'geo_events': self.geo.get_global_risk_events()[:3],
            'signals': []  # Would be populated with portfolio-specific signals
        }


# Test if run directly
if __name__ == '__main__':
    engine = IntelligenceEngine()
    
    # Test news
    print("Testing news feed...")
    news = engine.news.get_financial_news(days=1)
    print(f"Got {len(news)} articles")
    
    # Test fear/greed
    print("\nTesting fear/greed...")
    fng = engine.swarm.get_fear_greed_index()
    print(f"Fear/Greed: {fng.get('index')} ({fng.get('rating')})")
    
    # Test daily briefing
    print("\nTesting daily briefing...")
    briefing = engine.get_daily_briefing()
    print(f"Briefing generated with {len(briefing['top_news'])} news items")
