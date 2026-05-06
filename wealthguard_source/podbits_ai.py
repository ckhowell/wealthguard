#!/usr/bin/env python3
"""
PodBits AI Summarization Module
Uses Kimi API for intelligent episode summarization
"""

import os
import json
import logging
from typing import Optional, Dict, List
from dataclasses import dataclass

logger = logging.getLogger('podbits.ai')

# Try to import Kimi/OpenAI client
try:
    from openai import OpenAI
    KIMI_AVAILABLE = True
except ImportError:
    KIMI_AVAILABLE = False
    logger.warning("OpenAI client not installed. AI summarization will use fallback.")


@dataclass
class EpisodeSummary:
    """Structured episode summary"""
    brief_summary: str  # 2-3 sentence overview
    key_points: List[str]  # Bullet points of main topics
    notable_quotes: List[str]  # Memorable quotes
    people_mentioned: List[str]  # Names mentioned
    companies_tickers: List[str]  # Companies/stocks discussed
    sentiment: str  # Overall sentiment (bullish/bearish/neutral)
    action_items: List[str]  # Any actionable insights
    full_summary: str  # Complete summary


def get_kimi_client() -> Optional['OpenAI']:
    """Get Kimi/OpenAI client"""
    if not KIMI_AVAILABLE:
        return None
    
    # Try Kimi API first
    api_key = os.getenv('KIMI_API_KEY') or os.getenv('OPENAI_API_KEY')
    base_url = os.getenv('KIMI_BASE_URL', 'https://api.moonshot.ai/v1')
    
    if not api_key:
        logger.warning("No API key found for AI summarization")
        return None
    
    return OpenAI(api_key=api_key, base_url=base_url)


def extract_entities(text: str) -> Dict:
    """Extract people and companies from text using simple heuristics"""
    import re
    
    # Find capitalized names (potential people)
    people = set()
    name_pattern = r'\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b'
    potential_names = re.findall(name_pattern, text)
    common_words = {'The', 'This', 'That', 'These', 'Those', 'There', 'They', 'Then', 'Than'}
    for name in potential_names[:10]:
        if name not in common_words and len(name) > 5:
            people.add(name)
    
    # Find tickers (uppercase 1-5 letters in parentheses or after $)
    tickers = set()
    ticker_pattern = r'\$([A-Z]{1,5})\b|\(([A-Z]{1,5})\)'
    matches = re.findall(ticker_pattern, text)
    for match in matches:
        ticker = match[0] or match[1]
        if ticker:
            tickers.add(ticker)
    
    return {
        'people': list(people)[:5],
        'companies': list(tickers)[:5]
    }


def determine_sentiment(text: str) -> str:
    """Simple sentiment analysis based on keywords"""
    bullish_words = ['bullish', 'buy', 'growth', 'opportunity', 'upside', 'rally', 'moon', 'explode', 'rocket']
    bearish_words = ['bearish', 'sell', 'crash', 'recession', 'downside', 'bear', 'dump', 'collapse', 'risk']
    
    text_lower = text.lower()
    bullish_count = sum(1 for w in bullish_words if w in text_lower)
    bearish_count = sum(1 for w in bearish_words if w in text_lower)
    
    if bullish_count > bearish_count:
        return 'bullish'
    elif bearish_count > bullish_count:
        return 'bearish'
    return 'neutral'


def summarize_with_kimi(text: str, title: str, source_name: str) -> Optional[EpisodeSummary]:
    """Generate structured summary using Kimi API"""
    client = get_kimi_client()
    if not client:
        return None
    
    # Truncate text if too long (Kimi has context limits)
    max_chars = 15000
    if len(text) > max_chars:
        text = text[:max_chars] + "..."
    
    system_prompt = """You are an expert podcast analyst and financial researcher. 
Your task is to analyze podcast episodes and create structured summaries.

Extract the following in JSON format:
{
    "brief_summary": "2-3 sentence overview of the episode",
    "key_points": ["Main topic 1", "Main topic 2", "Main topic 3"],
    "notable_quotes": ["Quote 1", "Quote 2"],
    "people_mentioned": ["Name 1", "Name 2"],
    "companies_tickers": ["Company/Ticker 1", "Company/Ticker 2"],
    "sentiment": "bullish|bearish|neutral",
    "action_items": ["Actionable insight 1", "Actionable insight 2"],
    "full_summary": "Comprehensive summary in 3-5 paragraphs"
}

Guidelines:
- Brief summary should capture the main thesis
- Key points should be specific, not generic
- Notable quotes should be verbatim if possible
- Include full names of people mentioned
- Include ticker symbols for companies when mentioned
- Sentiment refers to market outlook (if discussed)
- Action items should be practical takeaways for investors
- Full summary should flow naturally as a narrative"""

    user_prompt = f"""Analyze this podcast episode from {source_name}:

Title: {title}

Content:
{text}

Provide a structured JSON summary following the format specified."""

    try:
        response = client.chat.completions.create(
            model=os.getenv('KIMI_MODEL', 'kimi-k2.6'),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.3,
            max_tokens=2000
        )
        
        content = response.choices[0].message.content
        
        # Extract JSON from response
        # Handle cases where JSON is wrapped in markdown
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        
        data = json.loads(content.strip())
        
        return EpisodeSummary(
            brief_summary=data.get("brief_summary", ""),
            key_points=data.get("key_points", []),
            notable_quotes=data.get("notable_quotes", []),
            people_mentioned=data.get("people_mentioned", []),
            companies_tickers=data.get("companies_tickers", []),
            sentiment=data.get("sentiment", "neutral"),
            action_items=data.get("action_items", []),
            full_summary=data.get("full_summary", "")
        )
        
    except Exception as e:
        logger.error(f"Error calling Kimi API: {e}")
        return None


def fallback_summarize(text: str, title: str) -> EpisodeSummary:
    """Generate summary without AI API - enhanced version that properly parses chapter markers"""
    import re
    
    # Parse chapter markers like "(0:00) Topic Name" or "(1:23:45) Long Topic Name"
    chapter_pattern = r'\((\d+:\d+(?::\d+)?)\)\s*([^\n\(]+?)(?=\(\d+:|\Z|$)'
    chapters = re.findall(chapter_pattern, text, re.DOTALL)
    
    # Clean up chapter text and extract key points
    key_points = []
    for timestamp, topic in chapters[:10]:  # Top 10 chapters
        # Clean up the topic text
        topic_clean = topic.strip()
        # Remove newlines and extra spaces
        topic_clean = ' '.join(topic_clean.split())
        # Remove trailing content that might be from description
        if len(topic_clean) > 200:
            topic_clean = topic_clean[:200].rsplit(' ', 1)[0]
        
        if len(topic_clean) > 5:
            key_points.append(topic_clean)
    
    # If no chapters parsed properly, try alternative patterns
    if not key_points:
        # Try to find numbered lists or bullet points
        bullet_pattern = r'(?:^|\n)\s*(?:[-•*]|\d+\.?)\s*([^\n]{10,100})'
        bullets = re.findall(bullet_pattern, text)
        key_points = [b.strip() for b in bullets[:6]]
    
    # Extract people mentioned (capitalized names) - improved filtering
    people_mentioned = []
    person_pattern = r'\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b'
    all_names = re.findall(person_pattern, text)
    
    # Expanded common words that aren't people
    common_words = {
        'The', 'This', 'That', 'These', 'Those', 'There', 'They', 'Then', 'Than',
        'With', 'From', 'Bestie', 'Follow', 'Sacks', 'Chamath', 'Jason', 'Friedberg',
        'The All', 'All In', 'Follow The', 'The Besties', 'The United',
        'Palantir Origins', 'Anduril Execs', 'Cia Analyst', 'Person Startup',
        'Friedberg Intros', 'Analyst Joins', 'Defense Tech', 'Silicon Valley',
        'Autonomous Weapons', 'Supply Chain', 'Surveillance State', 'Future Of',
        'SpaceX Ipo', 'Bitcoin Hack', 'Quantum Bitcoin', 'Small Cap',
        'Marriage Is', 'First Time', 'Partiful Is', 'Abundance Summit',
        'Monthly Portfolio', 'China Decode', 'China Walks', 'Middle East',
        'China Bends', 'Every Lif', 'Life Stage', 'Peter Nevill',
        'Iran War', 'Intro Music', 'Intro Video', 'What Tobias', 'Tobias Bucks',
        'Trade Desk', 'Ausbil Global', 'Small Caps', 'Weight Loss', 'Nike Stock',
        'Anthropic Code', 'Iran Conflict', 'Market Drop', 'Waymo Growth',
        'Portfolio Tracking', 'Why Portfolio', 'Deploying Cash', 'Cutting Stocks',
        'Markets Youtube', 'Channel Scott', 'Ed Elson', 'Substack Send',
        'New York', 'Better Call', 'Expedia Group', 'Singularity University',
        'Fountain Life', 'Link Ventures', 'Gulf Research', 'Formula One',
        'United States', 'Facebook Discussion', 'As Tim'
    }
    
    # Additional validation - check if it looks like a person's name
    def looks_like_person(name):
        parts = name.split()
        if len(parts) != 2:
            return False
        first, last = parts
        # Both parts should be capitalized properly
        if not (first[0].isupper() and first[1:].islower()):
            return False
        if not (last[0].isupper() and last[1:].islower()):
            return False
        # Filter out obvious non-names
        job_words = ['Analyst', 'Origins', 'Execs', 'Intros', 'Joins', 'Startup', 
                     'Tech', 'Valley', 'Weapons', 'Chain', 'State', 'Of', 'The', 
                     'Is', 'Time', 'First', 'Follow', 'All', 'In', 'Culture', 
                     'Influence', 'Gap', 'Threat', 'Supply', 'Surveillance', 'Claims',
                     'Factory', 'Combat', 'Run', 'Panics', 'Markets', 'Week', 'Moves',
                     'Made', 'Sense', 'Founders', 'Driving', 'Race', 'Bet', 'Update',
                     'Game', 'Walks', 'Line', 'Doubles', 'Down', 'Lif', 'Stage',
                     'Decode', 'East']
        if last in job_words:
            return False
        # First name shouldn't be a verb/preposition
        first_words = ['Follow', 'Watch', 'Listen', 'The', 'This', 'That', 'With', 'From']
        if first in first_words:
            return False
        return True
    
    for name in all_names:
        if name not in common_words and looks_like_person(name) and name not in people_mentioned:
            # Additional validation - check against job/business words that end names
            last_word = name.split()[-1]
            business_words = ['Gap', 'Threat', 'Supply', 'Surveillance', 'Origins', 'Intros', 
                              'Joins', 'Tech', 'Valley', 'Weapons', 'Chain', 'State', 'Factory',
                              'Combat', 'Claims', 'Run', 'Panics', 'Markets', 'Week', 'Moves',
                              'Made', 'Sense', 'Founders', 'Driving', 'Race', 'Bet', 'Update',
                              'Game', 'Walks', 'Line', 'Doubles', 'Down', 'Lif', 'Stage',
                              'Mates', 'Industries', 'You', 'My', 'Risk', 'Stock', 'From',
                              'Fund', 'Geared']
            if last_word not in business_words:
                people_mentioned.append(name)
    people_mentioned = people_mentioned[:6]
    
    # Extract companies and tickers - enhanced patterns
    companies_tickers = []
    
    # Look for $TICKER pattern
    ticker_dollar = re.findall(r'\$([A-Z]{1,5})\b', text)
    companies_tickers.extend(ticker_dollar)
    
    # Look for (TICKER) pattern
    ticker_paren = re.findall(r'\(([A-Z]{1,5})\)', text)
    companies_tickers.extend(ticker_paren)
    
    # Look for explicit company mentions in title
    known_companies = ['Palantir', 'Anduril', 'SpaceX', 'OpenAI', 'Anthropic', 
                       'Axon', 'Apple', 'Tesla', 'Nvidia', 'Microsoft', 'Google',
                       'Amazon', 'Meta', 'Uber', 'Nike', 'Eli Lilly', 'Koala']
    title_lower = title.lower()
    for company in known_companies:
        if company.lower() in title_lower and company not in companies_tickers:
            companies_tickers.append(company)
    
    # Look for crypto tickers
    crypto_tickers = ['BTC', 'ETH', 'SOL', 'XRP', 'SUI', 'ADA', 'DOT', 'AVAX']
    for ticker in crypto_tickers:
        if ticker in text and ticker not in companies_tickers:
            companies_tickers.append(ticker)
    
    # Remove duplicates while preserving order
    seen = set()
    companies_tickers = [x for x in companies_tickers if not (x in seen or seen.add(x))]
    companies_tickers = companies_tickers[:6]
    
    # Create intelligent brief summary
    if key_points:
        # Extract main theme from first chapter and title
        main_topic = key_points[0]
        additional_topics = ', '.join([kp.split(':')[0] if ':' in kp else kp[:30] for kp in key_points[1:3]])
        brief = f"This episode covers {main_topic}. Additional topics include {additional_topics}."
        # Clean up brief
        brief = brief.replace('..', '.').replace('  ', ' ')
    else:
        brief = f"{title}. This episode discusses key market and technology topics relevant to investors."
    
    # Determine sentiment
    bullish_words = ['growth', 'opportunity', 'bullish', 'rally', 'breakthrough', 'success', 'win', 'dominate', 'moon', 'explode', 'rocket', 'surge', 'soar']
    bearish_words = ['crisis', 'crash', 'recession', 'bearish', 'risk', 'threat', 'problem', 'decline', 'collapse', 'dump', 'crash', 'bear market']
    
    text_lower = text.lower()
    bullish_score = sum(2 if w in text_lower else 0 for w in bullish_words)
    bearish_score = sum(2 if w in text_lower else 0 for w in bearish_words)
    
    if bullish_score > bearish_score:
        sentiment = 'bullish'
    elif bearish_score > bullish_score:
        sentiment = 'bearish'
    else:
        sentiment = 'neutral'
    
    # Generate action items from key points
    action_items = []
    for point in key_points[:4]:
        # Look for actionable content or investment-related topics
        if any(w in point.lower() for w in ['watch', 'monitor', 'consider', 'evaluate', 'track', 'buy', 'sell', 'ipo', 'valuation', 'price', 'earnings', 'revenue']):
            action_items.append(f"Review: {point[:80]}")
    
    if not action_items:
        # Generate generic action items based on content
        if companies_tickers:
            action_items.append(f"Monitor mentioned companies: {', '.join(companies_tickers[:3])}")
        action_items.append("Review full episode for detailed investment insights")
    
    action_items = action_items[:3]
    
    # Build comprehensive full summary
    full_parts = []
    
    # Introduction
    full_parts.append(f"## Overview")
    full_parts.append(brief)
    
    # People section
    if people_mentioned:
        full_parts.append(f"\n## People Mentioned")
        full_parts.append(', '.join(people_mentioned))
    
    # Companies section
    if companies_tickers:
        full_parts.append(f"\n## Companies & Tickers")
        full_parts.append(', '.join(companies_tickers))
    
    # Key points section
    full_parts.append(f"\n## Discussion Topics")
    for i, point in enumerate(key_points[:8], 1):
        full_parts.append(f"{i}. {point}")
    
    # Sentiment section
    full_parts.append(f"\n## Market Sentiment")
    full_parts.append(f"Overall sentiment: {sentiment.capitalize()}")
    
    # Look for any quotes in the text
    quotes = re.findall(r'"([^"]{20,200})"', text)
    notable_quotes = quotes[:2] if quotes else []
    
    full = '\n'.join(full_parts)
    
    return EpisodeSummary(
        brief_summary=brief,
        key_points=key_points[:8],
        notable_quotes=notable_quotes,
        people_mentioned=people_mentioned,
        companies_tickers=companies_tickers,
        sentiment=sentiment,
        action_items=action_items,
        full_summary=full
    )


def summarize_episode(episode_id: int) -> Optional[Dict]:
    """Summarize a specific episode by ID"""
    import sqlite3
    
    _env_db = os.getenv('DATABASE_PATH', '')
    _local_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wealthguard.db')
    DB_PATH = _env_db if _env_db and os.path.exists(_env_db) else _local_db
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    try:
        # Get episode data
        row = conn.execute(
            """
            SELECT e.*, s.name as source_name
            FROM podbits_episodes e
            JOIN podbits_sources s ON e.source_id = s.id
            WHERE e.id = ?
            """,
            (episode_id,)
        ).fetchone()
        
        if not row:
            return None
        
        episode = dict(row)
        
        # Get content to summarize (prefer transcript, fallback to description)
        content = episode.get('transcript') or episode.get('description') or episode.get('summary')
        if not content or len(content) < 50:
            return {"error": "Not enough content to summarize"}
        
        # Try AI summary first, fallback to extractive
        ai_summary = summarize_with_kimi(
            content,
            episode['title'],
            episode['source_name']
        )
        
        if not ai_summary:
            logger.info(f"Using fallback summarization for episode {episode_id}")
            ai_summary = fallback_summarize(content, episode['title'])
        
        # Store the summary
        summary_data = {
            "brief_summary": ai_summary.brief_summary,
            "key_points": ai_summary.key_points,
            "notable_quotes": ai_summary.notable_quotes,
            "people_mentioned": ai_summary.people_mentioned,
            "companies_tickers": ai_summary.companies_tickers,
            "sentiment": ai_summary.sentiment,
            "action_items": ai_summary.action_items,
            "full_summary": ai_summary.full_summary
        }
        
        conn.execute(
            """
            UPDATE podbits_episodes
            SET summary = ?, is_processed = 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (json.dumps(summary_data), episode_id)
        )
        conn.commit()
        
        # Add tags based on AI analysis
        new_tags = []
        if ai_summary.sentiment:
            sentiment_tag = f"Sentiment: {ai_summary.sentiment.capitalize()}"
            new_tags.append(sentiment_tag)
        
        # Add people as tags
        for person in ai_summary.people_mentioned[:3]:
            if person and len(person) > 2:
                new_tags.append(f"Person: {person}")
        
        # Add companies as tags
        for company in ai_summary.companies_tickers[:3]:
            if company:
                new_tags.append(f"Company: {company}")
        
        # Insert new tags
        for tag_name in new_tags:
            try:
                # Get or create tag
                tag_row = conn.execute(
                    "SELECT id FROM podbits_tags WHERE name = ?",
                    (tag_name,)
                ).fetchone()
                
                if tag_row:
                    tag_id = tag_row['id']
                else:
                    cursor = conn.execute(
                        "INSERT INTO podbits_tags (name) VALUES (?)",
                        (tag_name,)
                    )
                    tag_id = cursor.lastrowid
                
                # Link tag to episode
                conn.execute(
                    "INSERT OR IGNORE INTO podbits_episode_tags (episode_id, tag_id) VALUES (?, ?)",
                    (episode_id, tag_id)
                )
            except Exception as e:
                logger.warning(f"Error adding tag {tag_name}: {e}")
        
        conn.commit()
        
        return {
            "episode_id": episode_id,
            "summary": summary_data,
            "new_tags": new_tags,
            "method": "ai" if KIMI_AVAILABLE and os.getenv('KIMI_API_KEY') else "fallback"
        }
        
    finally:
        conn.close()


def batch_summarize(limit: int = 10) -> List[Dict]:
    """Summarize multiple unprocessed episodes"""
    import sqlite3
    
    _env_db = os.getenv('DATABASE_PATH', '')
    _local_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wealthguard.db')
    DB_PATH = _env_db if _env_db and os.path.exists(_env_db) else _local_db
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    try:
        # Find episodes without AI summaries
        rows = conn.execute(
            """
            SELECT id FROM podbits_episodes
            WHERE summary IS NULL OR summary NOT LIKE '%{"brief_summary"%'
            ORDER BY published_at DESC
            LIMIT ?
            """,
            (limit,)
        ).fetchall()
        
        results = []
        for row in rows:
            result = summarize_episode(row['id'])
            if result and 'error' not in result:
                results.append(result)
        
        return results
        
    finally:
        conn.close()


def get_episode_summary(episode_id: int) -> Optional[Dict]:
    """Get structured summary for an episode"""
    import sqlite3
    
    _env_db = os.getenv('DATABASE_PATH', '')
    _local_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wealthguard.db')
    DB_PATH = _env_db if _env_db and os.path.exists(_env_db) else _local_db
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    try:
        row = conn.execute(
            "SELECT summary FROM podbits_episodes WHERE id = ?",
            (episode_id,)
        ).fetchone()
        
        if not row or not row['summary']:
            return None
        
        # Try to parse as JSON
        try:
            return json.loads(row['summary'])
        except:
            # Return as plain text if not JSON
            return {"full_summary": row['summary']}
            
    finally:
        conn.close()


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "--batch":
            # Batch summarize
            results = batch_summarize(limit=5)
            print(f"Summarized {len(results)} episodes")
            for r in results:
                print(f"  - Episode {r['episode_id']}: {len(r['summary']['key_points'])} key points")
        else:
            # Summarize specific episode
            episode_id = int(sys.argv[1])
            result = summarize_episode(episode_id)
            print(json.dumps(result, indent=2))
    else:
        print("Usage: python podbits_ai.py <episode_id> | --batch")
