#!/usr/bin/env python3
"""
WealthGuard News Intelligence Service
Uses NewsApi.ai (Event Registry) for financial news and sentiment
"""

import os
import json
import asyncio
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from dataclasses import dataclass

import aiohttp
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('wealthguard-news')

NEWSAPI_KEY = os.getenv('NEWSAPI_KEY', '')
NEWSAPI_BASE = "https://eventregistry.org/api/v1/article/getArticles"


@dataclass
class NewsArticle:
    title: str
    source: str
    url: str
    published_at: str
    summary: str
    sentiment: Optional[float] = None
    relevance: Optional[float] = None
    concepts: List[str] = None


class NewsIntelligence:
    """Fetches and analyzes financial news from NewsApi.ai"""
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key or NEWSAPI_KEY
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30))
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def fetch_financial_news(
        self, 
        query: str = None,
        symbols: List[str] = None,
        days: int = 1,
        max_results: int = 50
    ) -> List[NewsArticle]:
        """
        Fetch financial news for symbols or query
        
        Args:
            query: Search query (e.g., "stock market", "bitcoin")
            symbols: Stock/crypto symbols to search for
            days: How many days back to search
            max_results: Maximum articles to return
        """
        if not self.api_key:
            raise Exception("NEWSAPI_KEY not configured")
        
        # Build query
        if symbols:
            # Search for symbols with $ prefix (common in finance)
            symbol_query = " OR ".join([f"${s}" for s in symbols])
            search_query = f"({symbol_query}) AND (stock OR crypto OR price OR market)"
        else:
            search_query = query or "financial markets"
        
        # Date range
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        params = {
            "action": "getArticles",
            "keyword": search_query,
            "articlesPage": 1,
            "articlesCount": max_results,
            "articlesSortBy": "date",
            "articlesSortByAsc": "false",
            "dataType": ["news", "pr"],
            "includeArticleBasicInfo": "true",
            "includeArticleConcepts": "true",
            "includeArticleCategories": "true",
            "includeArticleLocation": "false",
            "includeArticleOriginalArticle": "true",
            "includeArticleSentiment": "true",
            "includeArticleSocialScore": "true",
            "articleLang": "eng",
            "dateStart": start_date.strftime("%Y-%m-%d"),
            "dateEnd": end_date.strftime("%Y-%m-%d"),
            "apiKey": self.api_key,
        }
        
        try:
            async with self.session.get(NEWSAPI_BASE, params=params) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise Exception(f"NewsApi.ai returned {resp.status}: {text[:200]}")
                
                data = await resp.json()
                articles = data.get("articles", {}).get("results", [])
                
                return [
                    NewsArticle(
                        title=a.get("title", ""),
                        source=a.get("source", {}).get("title", "Unknown"),
                        url=a.get("url", ""),
                        published_at=a.get("date", ""),
                        summary=a.get("body", "")[:300] + "..." if len(a.get("body", "")) > 300 else a.get("body", ""),
                        sentiment=a.get("sentiment", {}).get("score"),
                        relevance=a.get("relevance", 0),
                        concepts=[c.get("label", "") for c in a.get("concepts", [])[:5]]
                    )
                    for a in articles
                ]
        
        except Exception as e:
            logger.error(f"Failed to fetch news: {e}")
            return []
    
    async def fetch_portfolio_news(self, symbols: List[str]) -> Dict[str, List[NewsArticle]]:
        """Fetch news for each symbol in portfolio"""
        results = {}
        
        # Fetch in batches to avoid rate limits
        for symbol in symbols:
            try:
                articles = await self.fetch_financial_news(symbols=[symbol], days=7, max_results=5)
                results[symbol] = articles
                await asyncio.sleep(0.5)  # Rate limiting
            except Exception as e:
                logger.warning(f"Failed to fetch news for {symbol}: {e}")
                results[symbol] = []
        
        return results
    
    async def get_market_sentiment(self) -> Dict:
        """Get overall market sentiment from recent news"""
        try:
            articles = await self.fetch_financial_news(
                query="stock market OR crypto market OR bitcoin OR ethereum",
                days=1,
                max_results=100
            )
            
            if not articles:
                return {"score": 0, "label": "neutral", "articles_analyzed": 0}
            
            # Calculate weighted sentiment
            total_sentiment = 0
            total_weight = 0
            
            for article in articles:
                if article.sentiment is not None:
                    weight = article.relevance or 1.0
                    total_sentiment += article.sentiment * weight
                    total_weight += weight
            
            if total_weight == 0:
                return {"score": 0, "label": "neutral", "articles_analyzed": len(articles)}
            
            avg_sentiment = total_sentiment / total_weight
            
            # Normalize to -1 to 1 range if needed
            # NewsApi.ai returns 0 to 1 (0=negative, 0.5=neutral, 1=positive)
            normalized = (avg_sentiment - 0.5) * 2
            
            label = "positive" if normalized > 0.2 else "negative" if normalized < -0.2 else "neutral"
            
            return {
                "score": round(normalized, 3),
                "label": label,
                "articles_analyzed": len(articles),
                "raw_score": round(avg_sentiment, 3)
            }
        
        except Exception as e:
            logger.error(f"Failed to get market sentiment: {e}")
            return {"score": 0, "label": "error", "articles_analyzed": 0}


async def main():
    """Test the news intelligence"""
    async with NewsIntelligence() as news:
        print("Fetching market sentiment...")
        sentiment = await news.get_market_sentiment()
        print(f"Sentiment: {sentiment}")
        
        print("\nFetching portfolio news for AAPL, BTC...")
        portfolio_news = await news.fetch_portfolio_news(["AAPL", "BTC"])
        for symbol, articles in portfolio_news.items():
            print(f"\n{symbol}: {len(articles)} articles")
            for a in articles[:2]:
                print(f"  - {a.title[:60]}... (sentiment: {a.sentiment})")


if __name__ == "__main__":
    asyncio.run(main())
