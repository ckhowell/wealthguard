#!/usr/bin/env python3
"""
PodBits Transcript Fetcher
Fetches transcripts from podcast websites
"""

import os
import re
import ssl
import sqlite3
import logging
import urllib.request
from urllib.parse import urljoin
from typing import Optional, List


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


_SSL_CTX = _ssl_context()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('podbits.transcripts')

_env_db = os.getenv('DATABASE_PATH', '')
_local_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wealthguard.db')
DB_PATH = _env_db if _env_db and os.path.exists(_env_db) else _local_db


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def fetch_url(url: str, headers: dict = None) -> Optional[str]:
    """Fetch URL content"""
    try:
        default_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        if headers:
            default_headers.update(headers)
        
        req = urllib.request.Request(url, headers=default_headers)
        with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as response:
            return response.read().decode('utf-8', errors='ignore')
    except Exception as e:
        logger.error(f"Error fetching {url}: {e}")
        return None


def clean_transcript(html: str) -> str:
    """Clean HTML and extract transcript text"""
    # Remove script and style tags
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL)
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)
    
    # Convert common HTML tags to newlines
    html = re.sub(r'</p>', '\n\n', html)
    html = re.sub(r'<br[/\s]*>', '\n', html)
    html = re.sub(r'</div>', '\n', html)
    
    # Remove remaining HTML tags
    html = re.sub(r'<[^>]+?>', '', html)
    
    # Clean up whitespace
    html = re.sub(r'\n\s*\n\s*\n', '\n\n', html)
    html = re.sub(r'[ \t]+', ' ', html)
    
    return html.strip()


def fetch_allin_transcript(episode_url: str) -> Optional[str]:
    """Fetch transcript from All-In podcast website"""
    # All-In doesn't have public transcripts, but we can try to extract from the page
    # or note that we need to use Whisper
    logger.info(f"All-In transcripts not publicly available. URL: {episode_url}")
    return None


def fetch_moonshots_transcript(episode_url: str) -> Optional[str]:
    """Fetch transcript from Moonshots website"""
    html = fetch_url(episode_url)
    if not html:
        return None
    
    # Look for transcript section
    patterns = [
        r'Transcript\s*:?\s*(.+?)(?:\n\n\n|\Z)',
        r'Episode Transcript\s*(.+?)(?:SHOW NOTES|SPONSORS|\Z)',
        r'\u003cdiv[^\u003e]*class=["\'][^"\']*transcript[^"\']*["\'][^\u003e]*>(.+?)</div>',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
        if match:
            return clean_transcript(match.group(1))
    
    return None


def fetch_profg_transcript(episode_url: str) -> Optional[str]:
    """Fetch transcript from Prof G Markets"""
    html = fetch_url(episode_url)
    if not html:
        return None
    
    # Prof G is on various platforms
    # Try to find transcript
    patterns = [
        r'Transcript\s*(.+?)(?:\n\n\n|\Z)',
        r'\u003csection[^\u003e]*class=["\'][^"\']*transcript[^"\']*["\']\u003e(.+?)</section>',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
        if match:
            return clean_transcript(match.group(1))
    
    return None


def fetch_china_decode_transcript(episode_url: str) -> Optional[str]:
    """Fetch transcript from China Decode"""
    html = fetch_url(episode_url)
    if not html:
        return None
    
    # Look for transcript
    patterns = [
        r'Transcript\s*(.+?)(?:\n\n\n|\Z)',
        r'\u003cdiv[^\u003e]*class=["\']transcript["\'][^\u003e]*>(.+?)</div>',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
        if match:
            return clean_transcript(match.group(1))
    
    return None


def fetch_equity_mates_transcript(episode_url: str) -> Optional[str]:
    """Fetch transcript from Equity Mates"""
    html = fetch_url(episode_url)
    if not html:
        return None
    
    patterns = [
        r'Transcript\s*(.+?)(?:\n\n\n|\Z)',
        r'\u003cdiv[^\u003e]*class=["\']transcript["\']\u003e(.+?)</div>',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
        if match:
            return clean_transcript(match.group(1))
    
    return None


def get_youtube_transcript(video_id: str) -> Optional[str]:
    """Pull auto-captions from a YouTube video id via youtube-transcript-api."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        logger.warning("youtube-transcript-api not installed; skipping YouTube transcript")
        return None
    try:
        segments = YouTubeTranscriptApi.get_transcript(video_id, languages=['en', 'en-US', 'en-GB'])
        text = ' '.join(s.get('text', '').replace('\n', ' ') for s in segments if s.get('text'))
        text = re.sub(r'\s+', ' ', text).strip()
        return text or None
    except Exception as e:
        logger.info(f"No YouTube transcript for {video_id}: {e}")
        return None


def extract_youtube_id(url: str) -> Optional[str]:
    """Accept various YouTube URL shapes and return the video id."""
    if not url:
        return None
    patterns = [
        r'(?:youtube\.com/watch\?.*?v=|youtube\.com/embed/|youtu\.be/|youtube\.com/shorts/)([A-Za-z0-9_-]{11})',
        r'^([A-Za-z0-9_-]{11})$',
    ]
    for pat in patterns:
        m = re.search(pat, url)
        if m:
            return m.group(1)
    return None


_GEMINI_TRANSCRIBE_PROMPT = (
    "Transcribe this podcast episode verbatim. Return only the transcript — "
    "no commentary, no timestamps, no speaker labels unless clearly distinguishable."
)


def transcribe_audio_gemini(audio_url: str, max_mb: int = 500) -> Optional[str]:
    """Download an audio enclosure and transcribe with Gemini 2.5 Flash.

    Gated on GEMINI_API_KEY. Returns None on any error — caller should fall
    through to description-based summary.
    """
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        logger.info("Gemini: GEMINI_API_KEY not set")
        return None
    try:
        import google.generativeai as genai
    except ImportError:
        logger.warning("Gemini: google-generativeai package not installed")
        return None

    import tempfile, shutil, time
    tmp_path = None
    uploaded = None
    try:
        req = urllib.request.Request(
            audio_url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'},
        )
        with urllib.request.urlopen(req, timeout=60, context=_SSL_CTX) as resp:
            size = resp.headers.get('Content-Length')
            if size and int(size) > max_mb * 1024 * 1024:
                logger.info(f"Gemini: audio >{max_mb}MB, skipping {audio_url}")
                return None
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
                shutil.copyfileobj(resp, tmp)
                tmp_path = tmp.name
    except Exception as e:
        logger.warning(f"Gemini: download failed: {e}")
        return None

    try:
        genai.configure(api_key=api_key)
        uploaded = genai.upload_file(path=tmp_path, mime_type='audio/mpeg')

        # Gemini processes uploads asynchronously; poll until ACTIVE or timeout.
        deadline = time.time() + 600
        while uploaded.state.name == 'PROCESSING':
            if time.time() > deadline:
                logger.warning(f"Gemini: upload processing timed out for {audio_url}")
                return None
            time.sleep(2)
            uploaded = genai.get_file(uploaded.name)

        if uploaded.state.name != 'ACTIVE':
            logger.warning(f"Gemini: upload state={uploaded.state.name} for {audio_url}")
            return None

        model = genai.GenerativeModel('gemini-2.5-flash')
        resp = model.generate_content([_GEMINI_TRANSCRIBE_PROMPT, uploaded])
        return getattr(resp, 'text', None)
    except Exception as e:
        logger.warning(f"Gemini: transcription failed: {e}")
        return None
    finally:
        if uploaded is not None:
            try:
                genai.delete_file(uploaded.name)
            except Exception:
                pass
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def fetch_audio_transcript(audio_url: str) -> Optional[str]:
    """Preferred podcast-audio transcript path: Gemini 2.5 Flash if key set, else None."""
    return transcribe_audio_gemini(audio_url)


def update_episode_transcript(episode_id: int, transcript: str) -> bool:
    """Update episode with transcript"""
    conn = get_db_connection()
    try:
        conn.execute(
            "UPDATE podbits_episodes SET transcript = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (transcript, episode_id)
        )
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error updating episode {episode_id}: {e}")
        return False
    finally:
        conn.close()


def fetch_missing_transcripts() -> List[dict]:
    """Fetch transcripts for all episodes that don't have them"""
    conn = get_db_connection()
    
    try:
        cursor = conn.execute('''
            SELECT e.id, e.title, e.url, e.audio_url, s.name as source_name,
                   s.source_type as source_type, s.id as source_id
            FROM podbits_episodes e
            JOIN podbits_sources s ON e.source_id = s.id
            WHERE e.transcript IS NULL OR length(e.transcript) < 500
        ''')

        episodes = [dict(row) for row in cursor.fetchall()]
        results = []

        for ep in episodes:
            logger.info(f"Fetching transcript for: {ep['title'][:50]}...")

            transcript = None
            source_name = ep['source_name'].lower()
            source_type = (ep.get('source_type') or '').lower()

            # YouTube-sourced episodes: use the captions API directly.
            if source_type == 'youtube':
                vid = extract_youtube_id(ep['url'])
                if vid:
                    transcript = get_youtube_transcript(vid)

            if not transcript:
                # Try site-specific scrapers first.
                if 'all-in' in source_name or 'allin' in source_name:
                    transcript = fetch_allin_transcript(ep['url'])
                elif 'moonshot' in source_name:
                    transcript = fetch_moonshots_transcript(ep['url'])
                elif 'prof g' in source_name or 'galloway' in source_name:
                    transcript = fetch_profg_transcript(ep['url'])
                elif 'china' in source_name or 'decode' in source_name:
                    transcript = fetch_china_decode_transcript(ep['url'])
                elif 'equity' in source_name or 'mates' in source_name:
                    transcript = fetch_equity_mates_transcript(ep['url'])
                else:
                    transcript = fetch_moonshots_transcript(ep['url'])

            # Last resort: Gemini on the RSS audio enclosure.
            if not transcript and ep.get('audio_url'):
                transcript = fetch_audio_transcript(ep['audio_url'])
            
            if transcript and len(transcript) > 500:
                update_episode_transcript(ep['id'], transcript)
                results.append({
                    'episode_id': ep['id'],
                    'title': ep['title'],
                    'transcript_length': len(transcript),
                    'status': 'success'
                })
                logger.info(f"  ✓ Got transcript ({len(transcript)} chars)")
            else:
                results.append({
                    'episode_id': ep['id'],
                    'title': ep['title'],
                    'status': 'failed' if not transcript else 'too_short'
                })
                logger.warning(f"  ✗ No transcript found")
        
        return results
        
    finally:
        conn.close()


def get_ai_summary_for_episode(episode_id: int) -> Optional[dict]:
    """Generate AI summary for an episode using the real AI module"""
    try:
        from podbits_ai import summarize_episode
        result = summarize_episode(episode_id)
        return result
    except Exception as e:
        logger.error(f"Error generating AI summary for episode {episode_id}: {e}")
        return None


def regenerate_all_summaries() -> List[dict]:
    """Regenerate AI summaries for all episodes"""
    conn = get_db_connection()
    
    try:
        cursor = conn.execute('SELECT id, title FROM podbits_episodes')
        episodes = [dict(row) for row in cursor.fetchall()]
        
        results = []
        for ep in episodes:
            logger.info(f"Regenerating summary for: {ep['title'][:50]}...")
            result = get_ai_summary_for_episode(ep['id'])
            if result and 'error' not in result:
                results.append({
                    'episode_id': ep['id'],
                    'title': ep['title'],
                    'method': result.get('method', 'unknown'),
                    'new_tags': len(result.get('new_tags', []))
                })
                logger.info(f"  ✓ Summary generated ({result.get('method')})")
            else:
                results.append({
                    'episode_id': ep['id'],
                    'title': ep['title'],
                    'error': result.get('error') if result else 'No result'
                })
                logger.warning(f"  ✗ Failed: {result.get('error') if result else 'No result'}")
        
        return results
        
    finally:
        conn.close()


if __name__ == "__main__":
    import sys

    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))
    except ImportError:
        pass

    if len(sys.argv) > 1:
        if sys.argv[1] == "--fetch-transcripts":
            results = fetch_missing_transcripts()
            print(f"\nFetched transcripts for {sum(1 for r in results if r['status'] == 'success')}/{len(results)} episodes")
        elif sys.argv[1] == "--regenerate-summaries":
            results = regenerate_all_summaries()
            print(f"\nRegenerated summaries for {sum(1 for r in results if 'error' not in r)}/{len(results)} episodes")
        elif sys.argv[1] == "--episode":
            episode_id = int(sys.argv[2])
            result = get_ai_summary_for_episode(episode_id)
            print(result)
    else:
        print("Usage:")
        print("  python podbits_transcripts.py --fetch-transcripts")
        print("  python podbits_transcripts.py --regenerate-summaries")
        print("  python podbits_transcripts.py --episode <episode_id>")
