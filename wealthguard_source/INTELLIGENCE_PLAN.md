---
type: note
created: 2026-04-03
tags: [note, personal]
---

# WealthGuard Intelligence Enhancement Plan

## Table of Contents

- [[#Objective]]
- [[#1. NEWS & NARRATIVE SOURCES]]
- [[#2. SWARM DATA / RETAIL SENTIMENT]]
- [[#3. GEOPOLITICAL RISK]]
- [[#4. ALTERNATIVE DATA]]
- [[#5. RECOMMENDED INTEGRATION STACK]]
- [[#6. WEALTHGUARD IMPLEMENTATION]]
- [[#7. IMMEDIATE ACTION ITEMS]]
- [[#8. SWARM DATA ARCHITECTURE]]
- [[#Notes]]


## Objective
Integrate swarm data, news, geopolitics, and alternative data for better investment decisions.

---

## 1. NEWS & NARRATIVE SOURCES

### Tier 1 (Free/Cheap)
| Source | API | Use Case | Cost |
|--------|-----|----------|------|
| **NewsAPI.ai** | eventregistry.org | Global news aggregation, entity extraction | Free tier 500 req/day |
| **GNews** | gnews.io | Headlines, search | Free tier 100 req/day |
| **Currents API** | currentsapi.services | News with sentiment | Free tier 600 req/day |
| **NewsData.io** | newsdata.io | Crypto/finance focused | Free tier 200 req/day |

### Tier 2 (Paid but Worth It)
| Source | API | Use Case | Cost |
|--------|-----|----------|------|
| **Aylien** | aylien.com | News API with NLP | $0-249/month |
| **Bloomberg API** | bloomberg.com | Institutional grade | Enterprise only |
| **Refinitiv** | refinitiv.com | Market moving news | Enterprise |

### Implementation Strategy
```python
# Multi-source news aggregator
class NewsAggregator:
    def __init__(self):
        self.sources = {
            'newsapi': NewsAPIClient(),
            'gnews': GNewsClient(),
            'rss': RSSFeedManager()  # For ZeroHedge, FT, etc.
        }
    
    def get_sentiment(self, ticker):
        # Aggregate sentiment across all sources
        # Weight by source reliability
        pass
```

---

## 2. SWARM DATA / RETAIL SENTIMENT

### Sources
| Platform | Data Type | Access | Notes |
|----------|-----------|--------|-------|
| **Reddit** | r/wallstreetbets, r/stocks | PRAW API | Free, rate limited |
| **StockTwits** | Ticker sentiment | API | Free tier 200 req/hour |
| **Twitter/X** | Ticker mentions | API v2 | ~$100/month basic |
| **Google Trends** | Search interest | Unofficial | Free but limited |
| **Unusual Whales** | Options flow | API | $49/month |
| **Cheddar Flow** | Options flow | API | $79/month |
| **Quiver Quant** | Congressional trades, lobbying | API | $29/month |

### Key Signals to Track
1. **Social Volume**: Mention counts vs 30-day average
2. **Sentiment Score**: Bullish/bearish ratio
3. **Options Flow**: Unusual call/put activity
4. **Insider Trading**: Congress, corporate insiders
5. **Short Interest**: Borrow rates, utilization

### Implementation
```python
class SwarmDataAggregator:
    """Aggregate retail/sentiment data"""
    
    def get_fear_greed_index(self):
        # Combine multiple signals into 0-100 index
        signals = {
            'reddit_sentiment': self.get_reddit_sentiment(),
            'stocktwits_sentiment': self.get_stocktwits_sentiment(),
            'options_flow': self.get_options_flow(),
            'vix': self.get_vix_level(),
            'put_call_ratio': self.get_put_call_ratio()
        }
        return self.calculate_composite(signals)
```

---

## 3. GEOPOLITICAL RISK

### Sources
| Source | API | Focus | Cost |
|--------|-----|-------|------|
| **GeoQuant** | geoquant.io | Country risk scores | $$$ Enterprise |
| **Hedgeye** | hedgeye.com | Risk management research | Subscription |
| **Stratfor** | stratfor.com | Geopolitical forecasting | $$$ |
| **ACLED** | acleddata.com | Conflict data | Free for non-profit |
| **GDELT** | gdeltproject.org | Global events database | Free |
| **Event Registry** | eventregistry.org | News + events | Free tier |

### Risk Categories to Track
1. **Trade War Risk**: Tariffs, sanctions, export controls
2. **Currency Crisis**: Devaluations, capital controls
3. **Supply Chain**: Shipping disruptions, port closures
4. **Energy Security**: Oil/gas disruptions
5. **Political Instability**: Elections, coups, civil unrest

### Implementation
```python
class GeopoliticalRiskMonitor:
    def assess_portfolio_risk(self, holdings):
        """Score portfolio exposure to geopolitical events"""
        risks = {
            'china_exposure': self.get_china_risk_score(),
            'energy_exposure': self.get_energy_risk_score(),
            'emerging_markets': self.get_em_risk_score()
        }
        return risks
```

---

## 4. ALTERNATIVE DATA

### Categories
| Data Type | Provider | Use Case |
|-----------|----------|----------|
| **Satellite** | Orbital Insight, SpaceKnow | Parking lot counts, oil storage |
| **Web Traffic** | SimilarWeb, Alexa | Consumer demand signals |
| **Credit Cards** | Consumer Edge, Second Measure | Spending patterns |
| **Job Postings** | LinkUp, Burning Glass | Hiring trends |
| **App Data** | Sensor Tower, App Annie | Mobile engagement |
| **Shipping** | ImportGenius, Panjiva | Import/export volumes |

### Free/Cheap Alternatives
- **Google Trends**: Search interest as demand proxy
- **Wayback Machine**: Historical website changes
- **SEC EDGAR**: 13F filings, insider transactions
- **FRED**: Economic indicators (free from St. Louis Fed)

---

## 5. RECOMMENDED INTEGRATION STACK

### Phase 1 (Free Tier)
```yaml
News:
  - NewsAPI.ai (primary)
  - GNews (backup)
  
Sentiment:
  - Reddit (PRAW)
  - StockTwits (free tier)
  
Geopolitics:
  - GDELT (free)
  - Event Registry (free tier)
  
Alternative:
  - Google Trends
  - FRED
  - SEC EDGAR (insider trading)
```

### Phase 2 (Paid Tier)
```yaml
Add:
  - Twitter/X API ($100/month)
  - Unusual Whales ($49/month)
  - Quiver Quant ($29/month)
  - Cheddar Flow ($79/month)
  
Total: ~$257/month
```

### Phase 3 (Institutional)
```yaml
Add:
  - GeoQuant (geopolitical risk)
  - Bloomberg/Refinitiv
  - Satellite data providers
```

---

## 6. WEALTHGUARD IMPLEMENTATION

### New Module: `intelligence_engine.py`

```python
class IntelligenceEngine:
    """Aggregate all data sources for investment signals"""
    
    def __init__(self):
        self.news = NewsAggregator()
        self.sentiment = SwarmDataAggregator()
        self.geopolitical = GeopoliticalRiskMonitor()
        self.alternative = AlternativeDataFeed()
    
    def generate_signals(self, portfolio):
        """Generate buy/sell/hold signals based on all data"""
        signals = []
        
        # News sentiment
        for holding in portfolio:
            sentiment = self.news.get_sentiment(holding['symbol'])
            if sentiment['score'] < -0.5:
                signals.append({
                    'symbol': holding['symbol'],
                    'action': 'review',
                    'reason': f"Negative news sentiment: {sentiment['headline']}"
                })
        
        # Geopolitical risk
        geo_risk = self.geopolitical.assess_portfolio_risk(portfolio)
        if geo_risk['china_exposure'] > 0.7:
            signals.append({
                'action': 'diversify',
                'reason': 'High China exposure given current geopolitical tensions'
            })
        
        return signals
```

### New Dashboard Section
- **Signal Feed**: Real-time buy/sell signals
- **Sentiment Gauge**: Fear/greed index
- **Risk Monitor**: Geopolitical exposure alerts
- **News Stream**: Filtered by portfolio holdings

---

## 7. IMMEDIATE ACTION ITEMS

1. **Activate NewsAPI.ai** account (already have key)
2. **Apply for Reddit API** (PRAW)
3. **Sign up for StockTwits** API
4. **Set up Google Trends** scraper
5. **Integrate SEC EDGAR** for insider trading data

---

## 8. SWARM DATA ARCHITECTURE

The concept: 
- Individual investors ("swarm") collectively move markets
- Retail sentiment often leads institutional money
- Early detection of swarm behavior = alpha

### Key Metrics
```python
swarm_metrics = {
    'social_velocity': mentions_per_hour,
    'sentiment_shift': delta_from_24h_ago,
    'options_sweep': unusual_call_buying,
    'retail_flow': broker order flow imbalance,
    'dark_pool': institutional_off_exchange_activity
}
```

### Signal Generation
```python
def detect_swarm_movement(ticker):
    """Detect if retail swarm is moving into/out of ticker"""
    reddit = get_reddit_mentions(ticker)
    twitter = get_twitter_mentions(ticker)
    options = get_options_flow(ticker)
    
    # Swarm buy signal
    if reddit['growth'] > 300% and options['call_volume'] > 200%:
        return {'signal': 'swarm_buy', 'strength': 'high'}
    
    # Swarm sell signal  
    if reddit['sentiment'] < -0.6 and options['put_volume'] > 150%:
        return {'signal': 'swarm_sell', 'strength': 'medium'}
```

---

## Notes

- Free tier APIs have rate limits - implement caching
- Sentiment analysis needs NLP model (spaCy/NLTK or cloud API)
- Geopolitical risk is slow-moving but high-impact
- Alternative data requires cleaning/normalization
- Consider on-chain data for crypto (Glassnode, Dune Analytics)
