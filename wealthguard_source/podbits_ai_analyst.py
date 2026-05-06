#!/usr/bin/env python3
"""
PodBits AI analyst layer.

Takes the expert's `summary` JSON on an episode and produces an analyst-style
commentary: for each key_point, a 1-2 sentence AI take that agrees / disagrees /
adds context / cautions, plus portfolio impact against the user's holdings.

Stored as JSON in podbits_episodes.ai_analysis.

Provider cascade: Qwen → Gemini → Kimi → OpenAI. Silent fallthrough on auth /
rate-limit errors. On total failure returns None and the caller should surface
a "no analyst output" state.
"""
from __future__ import annotations

import os
import json
import sqlite3
import logging
import re
from datetime import datetime
from typing import Dict, List, Optional

logger = logging.getLogger('podbits.analyst')

_env_db = os.getenv('DATABASE_PATH', '')
_local_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wealthguard.db')
DB_PATH = _env_db if _env_db and os.path.exists(_env_db) else _local_db


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

STANCE_VALUES = {'agrees', 'disagrees', 'context', 'caution'}


def _user_holdings_snapshot() -> List[Dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT UPPER(symbol) AS symbol, asset_name, asset_class, "
            "shares * COALESCE(current_price, 0) AS value_native, asset_class "
            "FROM holdings WHERE shares > 0"
        ).fetchall()
    return [dict(r) for r in rows]


def _build_prompt(episode: Dict, summary: Dict, holdings: List[Dict]) -> str:
    key_points: List[str] = [
        p for p in (summary.get('key_points') or []) if isinstance(p, str) and p.strip()
    ]
    if not key_points:
        brief = summary.get('brief_summary')
        if isinstance(brief, str) and brief.strip():
            key_points = [brief.strip()]
    holdings_line = ', '.join(
        f"{h['symbol']} ({h.get('asset_class') or '?'})" for h in holdings[:25]
    ) or '(none tracked)'

    numbered = '\n'.join(f"{i}. {p}" for i, p in enumerate(key_points))
    return (
        "You are a pragmatic markets analyst reviewing claims made on a finance / tech / "
        "geopolitics podcast. Avoid cheerleading. Avoid boilerplate. Where a claim affects "
        "the user's portfolio, say so concretely.\n\n"
        f"EPISODE: {episode.get('title')}\n"
        f"SOURCE : {episode.get('source_name')}\n"
        f"BRIEF  : {(summary.get('brief_summary') or '').strip()[:600]}\n"
        f"USER HOLDINGS: {holdings_line}\n\n"
        "KEY POINTS (from the episode):\n"
        f"{numbered}\n\n"
        "Respond with PURE JSON in this shape, no markdown fences:\n"
        "{\n"
        '  "episode_take": "<1-3 sentence analyst POV on the whole episode>",\n'
        '  "pod_takes": [\n'
        "    {\n"
        '      "pod_take_idx": 0,\n'
        '      "stance": "agrees" | "disagrees" | "context" | "caution",\n'
        '      "confidence": "high" | "medium" | "low",\n'
        '      "ai_take": "<1-2 sentences>",\n'
        '      "tickers": ["UPPERCASE",...],\n'
        '      "portfolio_impact": "<null or 1 sentence about user holdings>"\n'
        "    }\n"
        "  ]\n"
        "}\n"
    )


# ---------------------------------------------------------------------------
# Provider calls — each returns raw text on success, None on auth/other errors.
# ---------------------------------------------------------------------------

def _extract_json(raw: str) -> Optional[Dict]:
    if not raw:
        return None
    # Strip ```json fences if present.
    txt = raw.strip()
    if txt.startswith('```'):
        txt = re.sub(r'^```(?:json)?\s*', '', txt)
        txt = re.sub(r'\s*```\s*$', '', txt)
    start = txt.find('{')
    end = txt.rfind('}')
    if start < 0 or end < start:
        return None
    try:
        return json.loads(txt[start:end + 1])
    except (json.JSONDecodeError, TypeError):
        return None


def _call_qwen(prompt: str) -> Optional[str]:
    key = os.getenv('QWEN_API_KEY')
    if not key:
        return None
    try:
        from openai import OpenAI
    except ImportError:
        return None
    try:
        client = OpenAI(
            api_key=key,
            base_url='https://dashscope.aliyuncs.com/compatible-mode/v1',
        )
        resp = client.chat.completions.create(
            model='qwen-plus',
            messages=[{'role': 'user', 'content': prompt}],
            temperature=0.3,
            max_tokens=2000,
        )
        return resp.choices[0].message.content
    except Exception as e:
        logger.info(f"Qwen analyst failed: {e}")
        return None


def _call_gemini(prompt: str) -> Optional[str]:
    key = os.getenv('GEMINI_API_KEY')
    if not key:
        return None
    try:
        import google.generativeai as genai
    except ImportError:
        return None
    try:
        genai.configure(api_key=key)
        model = genai.GenerativeModel(os.getenv('GEMINI_MODEL', 'gemini-2.5-flash'))
        resp = model.generate_content(prompt)
        return getattr(resp, 'text', None)
    except Exception as e:
        logger.info(f"Gemini analyst failed: {e}")
        return None


def _call_kimi(prompt: str) -> Optional[str]:
    key = os.getenv('KIMI_API_KEY')
    if not key:
        return None
    try:
        from openai import OpenAI
    except ImportError:
        return None
    try:
        client = OpenAI(
            api_key=key,
            base_url=os.getenv('KIMI_BASE_URL', 'https://api.moonshot.ai/v1'),
        )
        resp = client.chat.completions.create(
            model=os.getenv('KIMI_MODEL', 'kimi-k2.6'),
            messages=[{'role': 'user', 'content': prompt}],
            temperature=0.3,
            max_tokens=2000,
        )
        return resp.choices[0].message.content
    except Exception as e:
        logger.info(f"Kimi analyst failed: {e}")
        return None


def _call_openai(prompt: str) -> Optional[str]:
    key = os.getenv('OPENAI_API_KEY')
    if not key:
        return None
    try:
        from openai import OpenAI
    except ImportError:
        return None
    try:
        client = OpenAI(api_key=key)
        resp = client.chat.completions.create(
            model='gpt-4o-mini',
            messages=[{'role': 'user', 'content': prompt}],
            temperature=0.3,
            max_tokens=2000,
        )
        return resp.choices[0].message.content
    except Exception as e:
        logger.info(f"OpenAI analyst failed: {e}")
        return None


_PROVIDERS = (
    ('qwen', _call_qwen),
    ('gemini', _call_gemini),
    ('kimi', _call_kimi),
    ('openai', _call_openai),
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analyze_episode(episode_id: int, force: bool = False) -> Optional[Dict]:
    with _get_conn() as conn:
        row = conn.execute(
            """
            SELECT e.id, e.title, e.summary, e.ai_analysis, s.name AS source_name
            FROM podbits_episodes e
            LEFT JOIN podbits_sources s ON s.id = e.source_id
            WHERE e.id = ?
            """,
            (episode_id,),
        ).fetchone()
        if not row:
            return None
        if row['ai_analysis'] and not force:
            try:
                return json.loads(row['ai_analysis'])
            except (json.JSONDecodeError, TypeError):
                pass

        raw_summary = row['summary'] or ''
        summary: Dict = {}
        if raw_summary:
            try:
                summary = json.loads(raw_summary)
            except (json.JSONDecodeError, TypeError):
                # Plain-text summary from the ingest pipeline — wrap it so the
                # prompt builder has something to work with. One "key point" is
                # better than nothing; the LLM still produces useful commentary.
                text = raw_summary.strip()
                summary = {
                    'brief_summary': text[:800],
                    'key_points': [s.strip() for s in text.split('\n\n') if len(s.strip()) > 30][:6]
                                   or [text[:400]],
                }
        if not summary:
            return None

    holdings = _user_holdings_snapshot()
    prompt = _build_prompt({'title': row['title'], 'source_name': row['source_name']}, summary, holdings)

    raw = None
    used = None
    for name, fn in _PROVIDERS:
        raw = fn(prompt)
        if raw:
            used = name
            break
    parsed = _extract_json(raw) if raw else None
    if not parsed:
        return None

    # Normalise.
    takes = parsed.get('pod_takes') or []
    clean_takes: List[Dict] = []
    for t in takes:
        if not isinstance(t, dict):
            continue
        stance = (t.get('stance') or '').lower()
        if stance not in STANCE_VALUES:
            stance = 'context'
        clean_takes.append({
            'pod_take_idx': int(t.get('pod_take_idx') or 0),
            'stance': stance,
            'confidence': (t.get('confidence') or 'medium').lower(),
            'ai_take': str(t.get('ai_take') or '').strip(),
            'tickers': [str(x).upper() for x in (t.get('tickers') or []) if x][:8],
            'portfolio_impact': (t.get('portfolio_impact') or None) or None,
        })
    out = {
        'episode_take': str(parsed.get('episode_take') or '').strip(),
        'pod_takes': clean_takes,
        'method': used,
        'generated_at': datetime.utcnow().isoformat(),
    }

    with _get_conn() as conn:
        conn.execute(
            "UPDATE podbits_episodes SET ai_analysis = ?, ai_analysis_at = ? WHERE id = ?",
            (json.dumps(out), out['generated_at'], episode_id),
        )
        conn.commit()
    logger.info(f"Analyzed episode {episode_id} via {used} ({len(clean_takes)} takes)")
    return out


def analyze_batch(limit: int = 20, force: bool = False) -> List[Dict]:
    with _get_conn() as conn:
        if force:
            rows = conn.execute(
                "SELECT id FROM podbits_episodes WHERE summary IS NOT NULL AND summary != '' LIMIT ?",
                (limit,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id FROM podbits_episodes "
                "WHERE summary IS NOT NULL AND summary != '' AND (ai_analysis IS NULL OR ai_analysis = '') "
                "LIMIT ?",
                (limit,),
            ).fetchall()
    results: List[Dict] = []
    for r in rows:
        out = analyze_episode(r['id'], force=force)
        results.append({'episode_id': r['id'], 'ok': out is not None, 'takes': len((out or {}).get('pod_takes') or [])})
    return results
