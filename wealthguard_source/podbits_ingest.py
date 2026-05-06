#!/usr/bin/env python3
"""
PodBits Transcript Ingestion Pipeline
Fetches podcasts, extracts transcripts, generates summaries
"""

import os
import re
import json
import ssl
import sqlite3
import logging
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
from urllib.parse import urlparse
import urllib.request
import urllib.error

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('podbits.ingest')

_env_db = os.getenv('DATABASE_PATH', '')
_local_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wealthguard.db')
DB_PATH = _env_db if _env_db and os.path.exists(_env_db) else _local_db


def _ssl_context() -> ssl.SSLContext:
    """Prefer certifi's bundle (macOS python.org installers lack system roots)."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


_SSL_CTX = _ssl_context()


@dataclass
class RawEpisode:
    """Raw episode data from RSS/feed"""
    external_id: str
    title: str
    description: str
    url: str
    audio_url: Optional[str]
    published_at: str
    duration_seconds: Optional[int]
    transcript_url: Optional[str]
    transcript_text: Optional[str]


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def extract_podcast_id_from_apple_url(url: str) -> Optional[str]:
    """Extract podcast ID from Apple Podcasts URL"""
    # Format: https://podcasts.apple.com/.../id1234567890
    match = re.search(r'id(\d+)', url)
    if match:
        return match.group(1)
    return None


def get_rss_feed_from_apple(podcast_id: str) -> Optional[str]:
    """Get RSS feed URL from Apple Podcast ID using iTunes API"""
    try:
        # Try to lookup via iTunes API
        lookup_url = f"https://itunes.apple.com/lookup?id={podcast_id}"
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        req = urllib.request.Request(lookup_url, headers=headers)
        with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as response:
            data = json.loads(response.read().decode())
            
            if data.get('resultCount', 0) > 0:
                result = data['results'][0]
                feed_url = result.get('feedUrl')
                if feed_url:
                    return feed_url
                    
    except Exception as e:
        logger.error(f"Error looking up podcast {podcast_id}: {e}")
    
    return None


def parse_duration(duration_str: str) -> Optional[int]:
    """Parse duration string to seconds"""
    if not duration_str:
        return None
    
    # Try HH:MM:SS or MM:SS format
    parts = duration_str.split(':')
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        elif len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        elif len(parts) == 1:
            return int(parts[0])
    except ValueError:
        pass
    
    # Try seconds directly
    try:
        return int(duration_str)
    except ValueError:
        pass
    
    return None


def parse_rss_feed(rss_url: str, filter_rules: Optional[List[str]] = None) -> List[RawEpisode]:
    """Parse RSS feed and extract episodes"""
    episodes = []
    
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        req = urllib.request.Request(rss_url, headers=headers)
        with urllib.request.urlopen(req, timeout=60, context=_SSL_CTX) as response:
            content = response.read().decode('utf-8', errors='ignore')
        
        # Parse XML
        root = ET.fromstring(content)
        
        # Find channel and items (handle namespaces)
        channel = root.find('.//channel')
        if channel is None:
            channel = root
        
        # Get podcast-level info
        podcast_title = ""
        title_elem = channel.find('.//title')
        if title_elem is not None and title_elem.text:
            podcast_title = title_elem.text
        
        # Find all items (episodes)
        items = channel.findall('.//item')
        
        for item in items:
            try:
                # Extract episode data
                title_elem = item.find('title')
                title = title_elem.text if title_elem is not None else "Untitled"
                
                # Apply filter rules if present
                if filter_rules:
                    title_lower = title.lower()
                    if not any(rule.lower() in title_lower for rule in filter_rules):
                        continue
                
                # Get description/summary
                desc_elem = item.find('description')
                summary_elem = item.find('.//{http://www.itunes.com/dtds/podcast-1.0.dtd}summary')
                
                description = ""
                if desc_elem is not None and desc_elem.text:
                    description = desc_elem.text
                elif summary_elem is not None and summary_elem.text:
                    description = summary_elem.text
                
                # Clean HTML from description
                description = re.sub(r'<[^>]+>', '', description)
                description = description[:1000]  # Limit length
                
                # Get episode URL (link or enclosure)
                link_elem = item.find('link')
                url = link_elem.text if link_elem is not None else ""
                
                # Get audio enclosure
                enclosure = item.find('enclosure')
                audio_url = None
                if enclosure is not None:
                    audio_url = enclosure.get('url')
                    if not url and audio_url:
                        url = audio_url
                
                # Get GUID/external ID
                guid_elem = item.find('guid')
                if guid_elem is not None and guid_elem.text:
                    external_id = guid_elem.text
                else:
                    external_id = hash(title + str(datetime.now()))
                
                # Get publication date
                pub_date = None
                for date_tag in ['pubDate', 'published']:
                    date_elem = item.find(date_tag)
                    if date_elem is not None and date_elem.text:
                        pub_date = date_elem.text
                        break
                
                # Get duration
                duration = None
                itunes_duration = item.find('.//{http://www.itunes.com/dtds/podcast-1.0.dtd}duration')
                if itunes_duration is not None and itunes_duration.text:
                    duration = parse_duration(itunes_duration.text)
                
                # Look for transcript link
                transcript_url = None
                transcript_text = None
                
                # Check for transcript enclosure
                for enclosure in item.findall('enclosure'):
                    enc_type = enclosure.get('type', '')
                    if 'text' in enc_type or 'json' in enc_type or 'srt' in enc_type:
                        transcript_url = enclosure.get('url')
                        break
                
                # Check content:encoded for transcript
                content_elem = item.find('.//{http://purl.org/rss/1.0/modules/content/}encoded')
                if content_elem is not None and content_elem.text:
                    content = content_elem.text
                    # Look for transcript in content
                    if 'transcript' in content.lower():
                        # Try to extract transcript section
                        transcript_match = re.search(r'transcript[:\s]*(.+?)(?:\n\n|$)', content, re.I | re.S)
                        if transcript_match:
                            transcript_text = transcript_match.group(1)
                            transcript_text = re.sub(r'<[^>]+>', '', transcript_text)
                
                episode = RawEpisode(
                    external_id=str(external_id),
                    title=title,
                    description=description,
                    url=url or audio_url or "",
                    audio_url=audio_url,
                    published_at=pub_date or datetime.now().isoformat(),
                    duration_seconds=duration,
                    transcript_url=transcript_url,
                    transcript_text=transcript_text
                )
                
                episodes.append(episode)
                
            except Exception as e:
                logger.warning(f"Error parsing episode: {e}")
                continue
        
        logger.info(f"Parsed {len(episodes)} episodes from {podcast_title}")
        
    except Exception as e:
        logger.error(f"Error parsing RSS feed {rss_url}: {e}")
    
    return episodes


def fetch_youtube_channel_videos(channel_url: str, filter_rules: Optional[List[str]] = None) -> List[RawEpisode]:
    """Fetch videos from YouTube channel (requires yt-dlp)"""
    episodes = []
    
    try:
        import yt_dlp
        
        ydl_opts = {
            'extract_flat': True,
            'playlistend': 50,  # Limit to 50 recent videos
            'quiet': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(channel_url, download=False)
            
            if 'entries' in info:
                for entry in info['entries']:
                    if not entry:
                        continue
                    
                    title = entry.get('title', 'Untitled')
                    
                    # Apply filter rules
                    if filter_rules:
                        title_lower = title.lower()
                        if not any(rule.lower() in title_lower for rule in filter_rules):
                            continue
                    
                    episode = RawEpisode(
                        external_id=entry.get('id', ''),
                        title=title,
                        description=entry.get('description', '')[:500],
                        url=entry.get('webpage_url', '') or f"https://youtube.com/watch?v={entry.get('id')}",
                        audio_url=None,
                        published_at=datetime.fromtimestamp(entry.get('timestamp', 0)).isoformat() if entry.get('timestamp') else datetime.now().isoformat(),
                        duration_seconds=entry.get('duration'),
                        transcript_url=None,
                        transcript_text=None
                    )
                    
                    episodes.append(episode)
        
        logger.info(f"Fetched {len(episodes)} videos from YouTube channel")
        
    except ImportError:
        logger.error("yt-dlp not installed. Run: pip install yt-dlp")
    except Exception as e:
        logger.error(f"Error fetching YouTube videos: {e}")
    
    return episodes


def get_youtube_transcript(video_id: str) -> Optional[str]:
    """Get transcript from YouTube video using youtube-transcript-api"""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        
        ytt_api = YouTubeTranscriptApi()
        
        # Try to get transcript in English first, then any available
        try:
            transcript_list = ytt_api.fetch(video_id, languages=['en'])
        except:
            # Fallback to any available language
            transcript_list = ytt_api.fetch(video_id)
        
        # Combine all transcript pieces
        transcript_text = ' '.join([item.text for item in transcript_list])
        
        return transcript_text
        
    except Exception as e:
        logger.warning(f"Could not get transcript for {video_id}: {e}")
    
    return None


def transcribe_audio(audio_url: str) -> Optional[str]:
    """Transcribe audio using Whisper (requires whisper or faster-whisper)"""
    try:
        import tempfile
        import os
        
        # Download audio file
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
            headers = {'User-Agent': 'Mozilla/5.0'}
            req = urllib.request.Request(audio_url, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as response:
                tmp.write(response.read())
            tmp_path = tmp.name
        
        try:
            # Try faster-whisper first (faster, more accurate)
            from faster_whisper import WhisperModel
            
            model = WhisperModel("base", device="cpu", compute_type="int8")
            segments, _ = model.transcribe(tmp_path)
            
            transcript = ' '.join([segment.text for segment in segments])
            return transcript
            
        except ImportError:
            # Fall back to openai-whisper
            import whisper
            
            model = whisper.load_model("base")
            result = model.transcribe(tmp_path)
            return result["text"]
            
    except ImportError:
        logger.error("Whisper not installed. Run: pip install faster-whisper or openai-whisper")
    except Exception as e:
        logger.error(f"Error transcribing audio: {e}")
    finally:
        # Cleanup
        if 'tmp_path' in locals() and os.path.exists(tmp_path):
            os.unlink(tmp_path)
    
    return None


def generate_summary(text: str, title: str = "") -> str:
    """Generate summary using AI (Kimi/OpenAI)"""
    if not text or len(text) < 100:
        return "No content to summarize."
    
    try:
        # Try to use local summarization first (simple extraction)
        # For production, you'd integrate with Kimi/OpenAI API
        
        # Simple extractive summary - first few sentences + key points
        sentences = text.split('. ')
        
        # Take first 3 sentences as intro
        intro = '. '.join(sentences[:3]) + '.'
        
        # Look for key sections
        key_points = []
        keywords = ['key point', 'important', 'highlight', 'takeaway', 'conclusion', 'summary']
        
        for sentence in sentences:
            if any(kw in sentence.lower() for kw in keywords):
                key_points.append(sentence)
        
        # Build summary
        summary_parts = [intro]
        
        if key_points:
            summary_parts.append("\n\nKey Points:")
            for i, point in enumerate(key_points[:5], 1):
                summary_parts.append(f"{i}. {point}")
        
        # Add stats if found
        stats = re.findall(r'\$?[\d,]+(?:\.\d+)?(?:%|\s*(?:million|billion|thousand))?', text)
        if len(stats) > 0:
            summary_parts.append(f"\n\nNotable figures: {', '.join(list(set(stats))[:5])}")
        
        summary = '\n'.join(summary_parts)
        
        # Truncate if too long
        if len(summary) > 2000:
            summary = summary[:1997] + "..."
        
        return summary
        
    except Exception as e:
        logger.error(f"Error generating summary: {e}")
        return text[:1000] + "..." if len(text) > 1000 else text


def auto_tag_episode(title: str, description: str, transcript: str = "") -> List[str]:
    """Auto-generate tags based on content"""
    tags = []
    content = (title + " " + description + " " + transcript).lower()
    
    # Define tag patterns
    tag_patterns = {
        'Markets': ['market', 'stock', 'equity', 'trading', 'bull', 'bear', 'rally', 'crash'],
        'Crypto': ['crypto', 'bitcoin', 'btc', 'ethereum', 'eth', 'blockchain', 'defi'],
        'AI': ['ai', 'artificial intelligence', 'machine learning', 'llm', 'gpt', 'openai'],
        'China': ['china', 'chinese', 'beijing', 'shanghai', 'hong kong'],
        'US': ['us ', 'america', 'united states', 'fed', 'federal reserve', 'nasdaq'],
        'Australia': ['australia', 'australian', 'asx', 'aus', 'sydney', 'melbourne'],
        'Venture Capital': ['vc', 'venture capital', 'startup', 'funding', 'series a', 'valuation'],
        'Real Estate': ['real estate', 'property', 'housing', 'mortgage', 'rent'],
        'Economics': ['economy', 'gdp', 'inflation', 'recession', 'macro', 'fiscal'],
        'Tech': ['tech', 'technology', 'software', 'saas', 'cloud', 'semiconductor'],
        'Politics': ['politics', 'policy', 'election', 'government', 'regulation'],
        'Energy': ['energy', 'oil', 'gas', 'renewable', 'solar', 'climate'],
        'Interview': ['interview', 'guest', 'conversation with', 'talks to'],
        'Earnings': ['earnings', 'quarterly', 'revenue', 'profit', 'eps'],
        'Strategy': ['strategy', 'portfolio', 'allocation', 'diversification'],
    }
    
    for tag, keywords in tag_patterns.items():
        if any(kw in content for kw in keywords):
            tags.append(tag)
    
    return tags[:5]  # Limit to 5 tags


def process_source(source_id: int, max_episodes: int = 10) -> Dict:
    """Process a single source - fetch and ingest episodes"""
    conn = get_db_connection()
    
    try:
        # Get source info
        source = conn.execute(
            "SELECT * FROM podbits_sources WHERE id = ? AND is_active = 1",
            (source_id,)
        ).fetchone()
        
        if not source:
            return {"error": "Source not found or inactive"}
        
        source = dict(source)
        
        # Parse filter rules
        filter_rules = None
        if source.get('filter_rules'):
            try:
                filter_rules = json.loads(source['filter_rules'])
            except:
                filter_rules = [source['filter_rules']]
        
        # Fetch episodes based on source type
        if source['source_type'] == 'podcast':
            # Get RSS feed
            podcast_id = extract_podcast_id_from_apple_url(source['url'])
            if podcast_id:
                rss_url = get_rss_feed_from_apple(podcast_id)
            else:
                # Try URL directly as RSS
                rss_url = source['url']
            
            if not rss_url:
                return {"error": "Could not find RSS feed"}
            
            raw_episodes = parse_rss_feed(rss_url, filter_rules)
            
        elif source['source_type'] == 'youtube':
            raw_episodes = fetch_youtube_channel_videos(source['url'], filter_rules)
        else:
            return {"error": f"Unknown source type: {source['source_type']}"}
        
        # Process episodes
        processed = 0
        skipped = 0
        
        for raw_ep in raw_episodes[:max_episodes]:
            try:
                # Check if episode already exists
                existing = conn.execute(
                    "SELECT id FROM podbits_episodes WHERE external_id = ? OR (source_id = ? AND title = ?)",
                    (raw_ep.external_id, source_id, raw_ep.title)
                ).fetchone()
                
                if existing:
                    skipped += 1
                    continue
                
                # Get transcript
                transcript = raw_ep.transcript_text
                
                if not transcript and source['source_type'] == 'youtube':
                    # Try to get YouTube transcript
                    video_id = raw_ep.external_id
                    transcript = get_youtube_transcript(video_id)
                
                if not transcript and raw_ep.audio_url:
                    # Whisper fallback — gated on WHISPER_ENABLED + OPENAI_API_KEY.
                    try:
                        from podbits_transcripts import fetch_audio_transcript
                        transcript = fetch_audio_transcript(raw_ep.audio_url)
                    except Exception as e:
                        logger.warning(f"Whisper transcription failed: {e}")
                
                # Generate summary
                content_for_summary = transcript or raw_ep.description
                summary = generate_summary(content_for_summary, raw_ep.title)
                
                # Auto-tag
                tags = auto_tag_episode(raw_ep.title, raw_ep.description, transcript or "")
                
                # Insert episode
                cursor = conn.execute(
                    """
                    INSERT INTO podbits_episodes
                    (source_id, external_id, title, description, url, published_at,
                     transcript, summary, duration_seconds, is_processed, audio_url)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (source_id, raw_ep.external_id, raw_ep.title, raw_ep.description,
                     raw_ep.url, raw_ep.published_at, transcript, summary,
                     raw_ep.duration_seconds, True, raw_ep.audio_url)
                )
                
                episode_id = cursor.lastrowid
                
                # Add tags
                for tag_name in tags:
                    # Get or create tag
                    tag_row = conn.execute(
                        "SELECT id FROM podbits_tags WHERE name = ?",
                        (tag_name,)
                    ).fetchone()
                    
                    if tag_row:
                        tag_id = tag_row['id']
                    else:
                        cursor = conn.execute(
                            "INSERT INTO podbits_tags (name, color) VALUES (?, ?)",
                            (tag_name, None)
                        )
                        tag_id = cursor.lastrowid
                    
                    # Link tag to episode
                    conn.execute(
                        "INSERT OR IGNORE INTO podbits_episode_tags (episode_id, tag_id) VALUES (?, ?)",
                        (episode_id, tag_id)
                    )
                
                conn.commit()
                processed += 1
                
                logger.info(f"Processed episode: {raw_ep.title[:50]}...")
                
            except Exception as e:
                logger.error(f"Error processing episode {raw_ep.title}: {e}")
                continue
        
        # Update last checked
        conn.execute(
            "UPDATE podbits_sources SET last_checked_at = CURRENT_TIMESTAMP WHERE id = ?",
            (source_id,)
        )
        conn.commit()
        
        return {
            "source_id": source_id,
            "source_name": source['name'],
            "processed": processed,
            "skipped": skipped,
            "total_found": len(raw_episodes)
        }
        
    finally:
        conn.close()


def process_all_sources(max_per_source: int = 10) -> List[Dict]:
    """Process all active sources"""
    conn = get_db_connection()
    
    try:
        sources = conn.execute(
            "SELECT id FROM podbits_sources WHERE is_active = 1"
        ).fetchall()
        
        results = []
        for source in sources:
            result = process_source(source['id'], max_per_source)
            results.append(result)
        
        return results
        
    finally:
        conn.close()


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "--all":
        # Process all sources
        results = process_all_sources(max_per_source=5)
        print(json.dumps(results, indent=2))
    elif len(sys.argv) > 1:
        # Process specific source
        source_id = int(sys.argv[1])
        result = process_source(source_id, max_episodes=5)
        print(json.dumps(result, indent=2))
    else:
        print("Usage: python podbits_ingest.py <source_id> | --all")
