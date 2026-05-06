#!/usr/bin/env python3
"""
PodBits Real AI Summary Generator
Uses Moonshot/Kimi API for actual intelligent summarization
"""

import os
import sys
import json
import sqlite3
import logging
from typing import Optional, Dict, List

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('podbits.real_ai')

_env_db = os.getenv('DATABASE_PATH', '')
_local_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wealthguard.db')
DB_PATH = _env_db if _env_db and os.path.exists(_env_db) else _local_db

def get_api_key() -> Optional[str]:
    """Get API key from various sources"""
    # Try Qwen first (works reliably)
    qwen_key = os.getenv('QWEN_API_KEY')
    if qwen_key and len(qwen_key) > 20:
        return qwen_key, 'qwen'
    
    # Try Gemini
    gemini_key = os.getenv('GEMINI_API_KEY')
    if gemini_key and len(gemini_key) > 20:
        return gemini_key, 'gemini'
    
    # Try environment variables
    for key_name in ['KIMI_API_KEY', 'OPENAI_API_KEY', 'MOONSHOT_API_KEY']:
        key = os.getenv(key_name)
        if key and key != 'your_api_key_here':
            return key, 'kimi' if 'kimi' in key_name.lower() or 'moonshot' in key_name.lower() else 'openai'
    
    # Try to read from secrets file
    secrets_paths = [
        '/root/.openclaw/.secrets',
        os.path.expanduser('~/.qwen_key'),
        os.path.expanduser('~/.gemini_key'),
        os.path.expanduser('~/.kimi_key'),
        os.path.expanduser('~/.openai_key'),
    ]
    for path in secrets_paths:
        if os.path.exists(path):
            try:
                with open(path) as f:
                    key = f.read().strip()
                    if key and len(key) > 20:
                        if 'qwen' in path:
                            return key, 'qwen'
                        if 'gemini' in path:
                            return key, 'gemini'
                        return key, 'kimi' if 'kimi' in path or 'moonshot' in path else 'openai'
            except:
                pass
    
    return None, None


def get_api_id() -> Optional[str]:
    """Get API ID for Moonshot if available"""
    return os.getenv('KIMI_API_ID') or os.getenv('MOONSHOT_API_ID')


def summarize_with_qwen(title: str, description: str, source_name: str) -> Optional[Dict]:
    """Generate real AI summary using Qwen/DashScope API"""
    api_key = os.getenv('QWEN_API_KEY')
    if not api_key or len(api_key) < 20:
        return None
    
    try:
        from openai import OpenAI
        
        client = OpenAI(
            api_key=api_key,
            base_url='https://dashscope.aliyuncs.com/compatible-mode/v1'
        )
        
        system_prompt = """You are a financial podcast analyst. Create a structured summary of this podcast episode.

Respond in this exact JSON format:
{
    "brief_summary": "2-3 sentence summary of the main topics discussed",
    "key_points": ["Point 1", "Point 2", "Point 3", "Point 4"],
    "people_mentioned": ["Name 1", "Name 2"],
    "companies_tickers": ["AAPL", "TSLA", "Company Name"],
    "sentiment": "bullish|bearish|neutral",
    "action_items": ["Actionable insight 1", "Actionable insight 2"],
    "full_summary": "3-4 paragraph comprehensive summary"
}

Guidelines:
- Brief summary should capture the main thesis/argument
- Key points should be specific topics discussed
- Include specific companies and tickers mentioned
- Sentiment refers to market outlook discussed
- Action items should be practical takeaways for investors"""

        user_prompt = f"""Podcast: {source_name}
Title: {title}

Description/Chapter Markers:
{description}

Based on the title and description, create a structured summary of what this episode likely covers. Infer topics from chapter markers and title."""

        response = client.chat.completions.create(
            model="qwen-plus",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.3,
            max_tokens=1500
        )
        
        content = response.choices[0].message.content
        
        # Extract JSON
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        
        data = json.loads(content.strip())
        
        return {
            "brief_summary": data.get("brief_summary", ""),
            "key_points": data.get("key_points", []),
            "people_mentioned": data.get("people_mentioned", []),
            "companies_tickers": data.get("companies_tickers", []),
            "sentiment": data.get("sentiment", "neutral"),
            "action_items": data.get("action_items", []),
            "full_summary": data.get("full_summary", ""),
            "method": "qwen-ai"
        }
        
    except Exception as e:
        logger.error(f"Error calling Qwen API: {e}")
        return None


def summarize_with_gemini(title: str, description: str, source_name: str) -> Optional[Dict]:
    """Generate real AI summary using Google Gemini API"""
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key or len(api_key) < 20:
        return None
    
    try:
        import google.generativeai as genai
        
        genai.configure(api_key=api_key)
        
        model = genai.GenerativeModel('gemini-2.0-flash')
        
        prompt = f"""You are a financial podcast analyst. Create a structured summary of this podcast episode.

Podcast: {source_name}
Title: {title}
Description/Chapter Markers:
{description}

Respond ONLY in this exact JSON format (no markdown, no explanation):
{{
    "brief_summary": "2-3 sentence summary of the main topics discussed",
    "key_points": ["Point 1", "Point 2", "Point 3", "Point 4"],
    "people_mentioned": ["Name 1", "Name 2"],
    "companies_tickers": ["AAPL", "TSLA", "Company Name"],
    "sentiment": "bullish|bearish|neutral",
    "action_items": ["Actionable insight 1", "Actionable insight 2"],
    "full_summary": "3-4 paragraph comprehensive summary"
}}

Guidelines:
- Brief summary should capture the main thesis/argument
- Key points should be specific topics discussed
- Include specific companies and tickers mentioned
- Sentiment refers to market outlook discussed
- Action items should be practical takeaways for investors"""

        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.3,
                max_output_tokens=2000
            )
        )
        
        content = response.text
        
        # Extract JSON
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        
        data = json.loads(content.strip())
        
        return {
            "brief_summary": data.get("brief_summary", ""),
            "key_points": data.get("key_points", []),
            "people_mentioned": data.get("people_mentioned", []),
            "companies_tickers": data.get("companies_tickers", []),
            "sentiment": data.get("sentiment", "neutral"),
            "action_items": data.get("action_items", []),
            "full_summary": data.get("full_summary", ""),
            "method": "gemini-ai"
        }
        
    except Exception as e:
        logger.error(f"Error calling Gemini API: {e}")
        return None


def summarize_with_kimi(title: str, description: str, source_name: str) -> Optional[Dict]:
    """Generate real AI summary using Kimi API"""
    api_key, api_type = get_api_key()
    api_id = get_api_id()
    
    if not api_key:
        logger.error("No API key found. Set KIMI_API_KEY environment variable.")
        return None
    
    try:
        from openai import OpenAI
        
        # Build headers with API ID if available
        headers = {}
        if api_id:
            headers['X-API-ID'] = api_id
        
        client = OpenAI(
            api_key=api_key,
            base_url=os.getenv('KIMI_BASE_URL', 'https://api.moonshot.ai/v1'),
            default_headers=headers
        )
        
        system_prompt = """You are a financial podcast analyst. Create a structured summary of this podcast episode.

Respond in this exact JSON format:
{
    "brief_summary": "2-3 sentence summary of the main topics discussed",
    "key_points": ["Point 1", "Point 2", "Point 3", "Point 4"],
    "people_mentioned": ["Name 1", "Name 2"],
    "companies_tickers": ["AAPL", "TSLA", "Company Name"],
    "sentiment": "bullish|bearish|neutral",
    "action_items": ["Actionable insight 1", "Actionable insight 2"],
    "full_summary": "3-4 paragraph comprehensive summary"
}

Guidelines:
- Brief summary should capture the main thesis/argument
- Key points should be specific topics discussed
- Include specific companies and tickers mentioned
- Sentiment refers to market outlook discussed
- Action items should be practical takeaways for investors"""

        user_prompt = f"""Podcast: {source_name}
Title: {title}

Description/Chapter Markers:
{description}

Based on the title and description, create a structured summary of what this episode likely covers. Infer topics from chapter markers and title."""

        response = client.chat.completions.create(
            model=os.getenv('KIMI_MODEL', 'kimi-k2.6'),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.3,
            max_tokens=1500
        )
        
        content = response.choices[0].message.content
        
        # Extract JSON
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]
        
        data = json.loads(content.strip())
        
        return {
            "brief_summary": data.get("brief_summary", ""),
            "key_points": data.get("key_points", []),
            "people_mentioned": data.get("people_mentioned", []),
            "companies_tickers": data.get("companies_tickers", []),
            "sentiment": data.get("sentiment", "neutral"),
            "action_items": data.get("action_items", []),
            "full_summary": data.get("full_summary", ""),
            "method": "kimi-ai"
        }
        
    except Exception as e:
        logger.error(f"Error calling Kimi API: {e}")
        return None


def summarize_with_openai(title: str, description: str, source_name: str) -> Optional[Dict]:
    """Fallback to OpenAI if Kimi not available"""
    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key or api_key == 'your_api_key_here':
        return None
    
    try:
        from openai import OpenAI
        
        client = OpenAI(api_key=api_key)
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a financial podcast analyst. Create a structured summary."},
                {"role": "user", "content": f"Title: {title}\nDescription: {description}\n\nCreate a JSON summary with: brief_summary, key_points (list), people_mentioned (list), companies_tickers (list), sentiment, action_items (list), full_summary"}
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=1500
        )
        
        data = json.loads(response.choices[0].message.content)
        data["method"] = "openai"
        return data
        
    except Exception as e:
        logger.error(f"Error calling OpenAI: {e}")
        return None


def summarize_from_audio_gemini(audio_url: str, title: str, source_name: str,
                                 max_mb: int = 120) -> Optional[Dict]:
    """Transcribe + summarize podcast audio in a single Gemini multimodal call.

    Downloads the RSS audio enclosure, uploads to Gemini, and asks for a
    structured summary *plus* the transcript. This replaces the description-only
    path for episodes where audio is available.

    Returns the same summary shape as the text-based summarizers, with one
    extra key: ``transcript`` — which the caller should persist into the
    ``podbits_episodes.transcript`` column.
    """
    key = os.getenv('GEMINI_API_KEY')
    if not key:
        return None
    if not audio_url:
        return None
    try:
        import google.generativeai as genai
    except ImportError:
        logger.warning("google-generativeai not installed; skipping Gemini audio")
        return None

    import ssl as _ssl
    import urllib.request
    import tempfile
    import shutil
    import time
    try:
        import certifi
        ssl_ctx = _ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ssl_ctx = _ssl.create_default_context()

    # --- Download audio to a temp file (size-capped) ---------------------
    tmp_path = None
    try:
        req = urllib.request.Request(audio_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=60, context=ssl_ctx) as resp:
            size = resp.headers.get('Content-Length')
            if size and int(size) > max_mb * 1024 * 1024:
                logger.info(f"Gemini audio: {audio_url} > {max_mb}MB, skipping")
                return None
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
                shutil.copyfileobj(resp, tmp)
                tmp_path = tmp.name
    except Exception as e:
        logger.warning(f"Gemini audio: download failed for {audio_url}: {e}")
        return None

    try:
        genai.configure(api_key=key)
        try:
            audio_file = genai.upload_file(path=tmp_path, mime_type='audio/mpeg')
        except Exception as e:
            logger.warning(f"Gemini audio: upload failed: {e}")
            return None

        # Wait for Gemini to finish processing the file (typical 5–30s).
        deadline = time.time() + 180
        while getattr(audio_file, 'state', None) and audio_file.state.name == 'PROCESSING':
            if time.time() > deadline:
                logger.warning("Gemini audio: processing timeout")
                try:
                    genai.delete_file(audio_file.name)
                except Exception:
                    pass
                return None
            time.sleep(3)
            audio_file = genai.get_file(audio_file.name)
        if getattr(audio_file, 'state', None) and audio_file.state.name == 'FAILED':
            logger.warning("Gemini audio: file processing failed")
            return None

        prompt = f"""You are a financial podcast analyst. Listen to this episode and produce a single JSON object with:
- "transcript": the full spoken transcript, lightly cleaned (no "uh"/"um", no speaker labels)
- "brief_summary": 2-3 sentence thesis of the episode
- "key_points": 5-8 of the most intelligent and relevant claims made (each 1 sentence, specific, include numbers/tickers where mentioned)
- "people_mentioned": speakers/guests/notable names
- "companies_tickers": uppercase tickers or company names the hosts discussed
- "sentiment": one of "bullish" | "bearish" | "neutral"
- "action_items": 3-5 concrete takeaways for an investor
- "full_summary": 3-4 paragraph analyst-style summary

EPISODE: {title}
SOURCE : {source_name}

Return PURE JSON only. No markdown fences, no commentary. Keep the transcript even if long.
"""

        model_name = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')
        model = genai.GenerativeModel(model_name)
        try:
            resp = model.generate_content(
                [prompt, audio_file],
                generation_config=genai.types.GenerationConfig(
                    response_mime_type='application/json',
                    temperature=0.3,
                    max_output_tokens=16000,
                ),
            )
        except Exception as e:
            logger.warning(f"Gemini audio: generate_content failed: {e}")
            return None
        finally:
            try:
                genai.delete_file(audio_file.name)
            except Exception:
                pass

        raw = getattr(resp, 'text', None) or ''
        if not raw:
            return None
        txt = raw.strip()
        if txt.startswith('```'):
            import re as _re
            txt = _re.sub(r'^```(?:json)?\s*', '', txt)
            txt = _re.sub(r'\s*```\s*$', '', txt)
        try:
            data = json.loads(txt)
        except json.JSONDecodeError:
            start, end = txt.find('{'), txt.rfind('}')
            if start < 0 or end < start:
                logger.warning("Gemini audio: no JSON in response")
                return None
            try:
                data = json.loads(txt[start:end + 1])
            except json.JSONDecodeError as e:
                logger.warning(f"Gemini audio: JSON parse failed: {e}")
                return None

        return {
            'brief_summary': data.get('brief_summary', ''),
            'key_points': data.get('key_points', []),
            'people_mentioned': data.get('people_mentioned', []),
            'companies_tickers': data.get('companies_tickers', []),
            'sentiment': data.get('sentiment', 'neutral'),
            'action_items': data.get('action_items', []),
            'full_summary': data.get('full_summary', ''),
            'transcript': data.get('transcript', '') or '',
            'method': f'gemini-audio ({model_name})',
        }
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def regenerate_episode_summary(episode_id: int, force: bool = False) -> Optional[Dict]:
    """Regenerate summary for a specific episode"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    try:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT e.id, e.title, e.description, e.audio_url, s.name as source_name
            FROM podbits_episodes e
            JOIN podbits_sources s ON e.source_id = s.id
            WHERE e.id = ?
        ''', (episode_id,))

        row = cursor.fetchone()
        if not row:
            logger.error(f"Episode {episode_id} not found")
            return None

        episode = dict(row)
        summary = None
        transcript_from_audio: Optional[str] = None

        # Preferred: transcribe + summarize directly from the audio via Gemini.
        # Gated on GEMINI_API_KEY + audio_url being present; silently falls
        # through to description-based summarization on any failure.
        if episode.get('audio_url') and os.getenv('PODBITS_AUDIO_SUMMARY', 'true').lower() not in ('0', 'false', 'no'):
            logger.info(f"Trying Gemini audio summary for episode {episode_id}")
            summary = summarize_from_audio_gemini(
                episode['audio_url'],
                episode['title'],
                episode['source_name'],
            )
            if summary:
                transcript_from_audio = summary.pop('transcript', '') or None

        # Description-only fallbacks: Qwen → Gemini → Kimi → OpenAI
        if not summary:
            summary = summarize_with_qwen(
                episode['title'],
                episode['description'] or '',
                episode['source_name']
            )

        if not summary:
            summary = summarize_with_gemini(
                episode['title'],
                episode['description'] or '',
                episode['source_name']
            )

        if not summary:
            summary = summarize_with_kimi(
                episode['title'],
                episode['description'] or '',
                episode['source_name']
            )

        if not summary:
            summary = summarize_with_openai(
                episode['title'],
                episode['description'] or '',
                episode['source_name']
            )
        
        if summary:
            # Save to database. If we transcribed from audio, also persist the
            # transcript so search / display / re-summarization can use it.
            if transcript_from_audio and len(transcript_from_audio) > 200:
                cursor.execute('''
                    UPDATE podbits_episodes
                    SET summary = ?, transcript = ?, is_processed = 1, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', (json.dumps(summary), transcript_from_audio, episode_id))
            else:
                cursor.execute('''
                    UPDATE podbits_episodes
                    SET summary = ?, is_processed = 1, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', (json.dumps(summary), episode_id))
            
            # Add tags from AI output
            tags = []
            if summary.get('sentiment'):
                tags.append(f"Sentiment: {summary['sentiment'].capitalize()}")
            for person in summary.get('people_mentioned', [])[:3]:
                tags.append(f"Person: {person}")
            for company in summary.get('companies_tickers', [])[:3]:
                tags.append(f"Company: {company}")
            
            for tag_name in tags:
                try:
                    # Get or create tag
                    tag_row = cursor.execute(
                        "SELECT id FROM podbits_tags WHERE name = ?",
                        (tag_name,)
                    ).fetchone()
                    
                    if tag_row:
                        tag_id = tag_row['id']
                    else:
                        cursor.execute(
                            "INSERT INTO podbits_tags (name) VALUES (?)",
                            (tag_name,)
                        )
                        tag_id = cursor.lastrowid
                    
                    # Link tag to episode
                    cursor.execute('''
                        INSERT OR IGNORE INTO podbits_episode_tags (episode_id, tag_id)
                        VALUES (?, ?)
                    ''', (episode_id, tag_id))
                except Exception as e:
                    logger.warning(f"Error adding tag {tag_name}: {e}")
            
            conn.commit()
            logger.info(f"✓ Regenerated summary for episode {episode_id} using {summary['method']}")
            return summary
        else:
            logger.error(f"✗ Failed to generate summary for episode {episode_id}")
            return None
            
    finally:
        conn.close()


def regenerate_all_summaries(force: bool = False) -> List[Dict]:
    """Regenerate all episode summaries with real AI"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT id, title FROM podbits_episodes ORDER BY published_at DESC')
        episodes = cursor.fetchall()
        
        results = []
        logger.info(f"Regenerating {len(episodes)} episode summaries...")
        
        for i, ep in enumerate(episodes, 1):
            logger.info(f"[{i}/{len(episodes)}] Processing: {ep['title'][:50]}...")
            result = regenerate_episode_summary(ep['id'], force)
            results.append({
                'episode_id': ep['id'],
                'title': ep['title'],
                'success': result is not None,
                'method': result.get('method') if result else None
            })
            
            # Rate limiting - sleep between requests
            if i < len(episodes):
                import time
                time.sleep(1)
        
        success_count = sum(1 for r in results if r['success'])
        logger.info(f"\nCompleted: {success_count}/{len(episodes)} summaries regenerated")
        return results
        
    finally:
        conn.close()


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Generate real AI summaries for PodBits')
    parser.add_argument('--episode', type=int, help='Regenerate specific episode')
    parser.add_argument('--all', action='store_true', help='Regenerate all episodes')
    parser.add_argument('--force', action='store_true', help='Force regeneration even if already processed')
    parser.add_argument('--check-key', action='store_true', help='Check if API key is configured')
    
    args = parser.parse_args()
    
    if args.check_key:
        key, api_type = get_api_key()
        if key:
            print(f"✓ API key found ({api_type})")
            print(f"  Key preview: {key[:10]}...{key[-5:]}")
            
            # Test the key
            if api_type == 'qwen':
                result = summarize_with_qwen("Test", "Test description", "Test")
                if result:
                    print("  ✓ Qwen API is working")
                else:
                    print("  ✗ Qwen API test failed")
            elif api_type == 'gemini':
                result = summarize_with_gemini("Test", "Test description", "Test")
                if result:
                    print("  ✓ Gemini API is working")
                else:
                    print("  ✗ Gemini API test failed")
            elif api_type == 'kimi':
                print("  Note: Kimi API has known authentication issues")
        else:
            print("✗ No API key found")
            print("  Set QWEN_API_KEY, GEMINI_API_KEY, KIMI_API_KEY, or OPENAI_API_KEY")
            print("  Or create ~/.qwen_key, ~/.gemini_key, ~/.kimi_key, or ~/.openai_key file")
        return
    
    if args.episode:
        result = regenerate_episode_summary(args.episode, args.force)
        if result:
            print(f"\nSummary for episode {args.episode}:")
            print(json.dumps(result, indent=2))
        else:
            print(f"Failed to generate summary for episode {args.episode}")
    elif args.all:
        results = regenerate_all_summaries(args.force)
        print(f"\nRegenerated {sum(1 for r in results if r['success'])}/{len(results)} summaries")
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
