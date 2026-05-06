#!/usr/bin/env python3
"""
Explode podbits_episodes.summary JSON into individual "narrative" rows —
one per key_point / notable_quote / action_item — so the frontend can render
a scrollable feed of expert takes rather than a catalog of episodes.

Pure-python, no extra deps. Safe against partial/legacy summary JSON.
"""
from __future__ import annotations

import os
import re
import json
import sqlite3
import logging
from typing import Dict, Iterable, List, Optional, Set, Tuple

logger = logging.getLogger('podbits.narratives')

_env_db = os.getenv('DATABASE_PATH', '')
_local_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wealthguard.db')
DB_PATH = _env_db if _env_db and os.path.exists(_env_db) else _local_db


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _portfolio_symbols() -> Set[str]:
    try:
        with _get_conn() as conn:
            rows = conn.execute(
                "SELECT DISTINCT UPPER(symbol) AS s FROM holdings WHERE shares > 0"
            ).fetchall()
        # Also throw in common aliases so "Bitcoin" matches BTC-like mentions.
        aliases = {
            'BTC': ['BITCOIN'],
            'ETH': ['ETHEREUM', 'ETHER'],
            'SOL': ['SOLANA'],
            'XRP': ['RIPPLE'],
            'SUI': ['SUI NETWORK'],
            'NVDA': ['NVIDIA'],
            'AAPL': ['APPLE'],
            'GOOGL': ['ALPHABET', 'GOOGLE'],
            'XLE': [],
            'GPRO': ['GOPRO'],
        }
        full: Set[str] = set()
        for r in rows:
            full.add(r['s'])
            for a in aliases.get(r['s'], []):
                full.add(a)
        return full
    except sqlite3.Error:
        return set()


def _parse_summary(raw: Optional[str]) -> Optional[Dict]:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Quality filters. The fallback summarizer (extractive, pre-LLM) emits a lot
# of junk: sponsor lines, sidebar navigation ("Channel Scott", "Substack"),
# timecodes, URL fragments, and the episode title repeated as a bullet.
# These filters trim the feed down to stuff that actually reads like a claim.
# ---------------------------------------------------------------------------

_JUNK_PHRASES = (
    'sharesight', 'promo code', 'sponsor', 'patreon', 'linktree', 'discount',
    'review full episode', 'full episode for', 'subscribe on', 'follow on',
    'save 4 months', 'apple podcasts', 'spotify', 'buy at', 'order at',
    '0% off', '% off',
    # Generic fallback-summarizer filler
    'this episode discusses key market',
    'monitor mentioned companies',
    'monitor mentioned company',
    'review episode for',
    'check the show notes',
    'listen to the full episode',
    'bestie intros',
    'bestie intro',
)
_JUNK_PREFIXES = (
    'channel ', 'substack ', 'http', 'www.',
    'sign up', 'submit a question',
    'notes on ',              # "Notes on Being a Man," fragment
    'first time founders:',   # show-within-show promo bumper
)
_JUNK_REGEX = re.compile(
    r'^\s*('
    r'\d{1,2}:\d{2}'           # timecodes like "00:50"
    r'|[A-Za-z]+:\s*[A-Za-z]*' # "Channel: Scott"
    r'|[-–—•]+'                # leading bullet chars
    r')',
    re.IGNORECASE,
)


def _normalize(s: str) -> str:
    s = s.strip()
    # strip leading bullets, hyphens, numbering
    s = re.sub(r'^[\s\-–—•\*\d\.\)\(]+', '', s)
    return s.strip()


def _is_low_quality(text: str, episode_title: str) -> bool:
    if not text:
        return True
    t = _normalize(text)
    if len(t) < 22:
        return True
    if len(t.split()) < 4:
        return True
    # Trailing-comma fragments ("Notes on Being a Man,") are almost always bullet junk.
    if t.endswith(',') and len(t) < 60:
        return True
    low = t.lower()
    if low.startswith(_JUNK_PREFIXES):
        return True
    if any(p in low for p in _JUNK_PHRASES):
        return True
    if _JUNK_REGEX.match(t):
        return True
    # Echo of episode title — skip near-duplicates.
    if episode_title:
        title = episode_title.lower().strip()
        if low == title or (title and (title in low or low in title) and abs(len(title) - len(low)) < 20):
            return True
    # URLs or obvious links
    if 'http' in low or '.com' in low or '.co/' in low or 'www.' in low:
        return True
    # Pure timestamp blob
    if re.match(r'^[\d:\s\-–—.,]+$', t):
        return True
    # Hashtag- or at-handle-only fragments
    if re.match(r'^[@#][\w\-]+(\s+[@#][\w\-]+)*$', t):
        return True
    return False


def _llm_generated(summary: Dict) -> bool:
    method = (summary.get('method') or '').lower()
    return method in {'kimi', 'openai', 'gemini', 'qwen', 'llm'}


def _mentions_portfolio(text: str, people: List[str], tickers: List[str], port: Set[str]) -> List[str]:
    if not port:
        return []
    hay = f"{text} {' '.join(tickers)} {' '.join(people)}".upper()
    hits: List[str] = []
    for sym in port:
        if not sym:
            continue
        # Whole-word-ish match to avoid 'SOL' inside 'SOLD'.
        pattern = f" {sym} "
        if pattern in f" {hay} ":
            hits.append(sym)
    return sorted(set(hits))


def _iter_narratives(
    limit: int,
    source_id: Optional[int],
    person: Optional[str],
    ticker: Optional[str],
    sentiment: Optional[str],
    only_mine: bool,
) -> Iterable[Dict]:
    with _get_conn() as conn:
        where = ["e.summary IS NOT NULL", "e.summary != ''"]
        params: List = []
        if source_id is not None:
            where.append("e.source_id = ?")
            params.append(source_id)
        query = f"""
            SELECT e.id, e.source_id, e.title, e.url, e.published_at, e.summary,
                   e.ai_analysis, e.ai_analysis_at,
                   s.name AS source_name
            FROM podbits_episodes e
            LEFT JOIN podbits_sources s ON s.id = e.source_id
            WHERE {' AND '.join(where)}
            ORDER BY COALESCE(e.published_at, e.created_at) DESC
            LIMIT 500
        """
        rows = conn.execute(query, params).fetchall()

    port_global = _portfolio_symbols()
    port = port_global if only_mine else set()
    needle_person = person.lower() if person else None
    needle_ticker = ticker.upper() if ticker else None
    needle_sent = sentiment.lower() if sentiment else None

    # Per-episode deduped-and-filtered lists → interleaved output.
    per_episode: List[Tuple[Dict, List[Dict]]] = []
    seen_global: Set[str] = set()  # cross-episode dedupe (same boilerplate in multiple shows)

    for ep in rows:
        summary = _parse_summary(ep['summary']) or {}
        ai_analysis = _parse_summary(ep['ai_analysis']) or {}
        ai_takes_by_idx: Dict[int, Dict] = {}
        for t in (ai_analysis.get('pod_takes') or []):
            if isinstance(t, dict):
                ai_takes_by_idx[int(t.get('pod_take_idx') or 0)] = t
        episode_take = ai_analysis.get('episode_take') or None
        ai_method = ai_analysis.get('method') or None

        people = [str(p) for p in (summary.get('people_mentioned') or []) if p]
        tickers = [str(t).upper() for t in (summary.get('companies_tickers') or []) if t]
        raw_sent = (summary.get('sentiment') or '').lower()
        is_llm = _llm_generated(summary)
        ep_sentiment = raw_sent if is_llm else None  # only surface when AI-produced

        raw_key = [p for p in (summary.get('key_points') or []) if isinstance(p, str) and p.strip()]
        raw_quotes = [q for q in (summary.get('notable_quotes') or []) if isinstance(q, str) and q.strip()]
        raw_actions = [a for a in (summary.get('action_items') or []) if isinstance(a, str) and a.strip()]

        # If the structured fields are degenerate, fall back to brief_summary once.
        if not raw_key and not raw_quotes:
            brief = summary.get('brief_summary')
            if isinstance(brief, str) and brief.strip():
                raw_key = [brief.strip()]

        seen_local: Set[str] = set()

        def build(entries: List[str], kind: str) -> List[Dict]:
            out: List[Dict] = []
            for i, raw in enumerate(entries):
                text = _normalize(raw)
                if _is_low_quality(text, ep['title'] or ''):
                    continue
                key = text.lower()[:120]
                if key in seen_local or key in seen_global:
                    continue
                seen_local.add(key)
                seen_global.add(key)
                holdings_hit = _mentions_portfolio(text, people, tickers, port_global)
                ai = ai_takes_by_idx.get(i) if kind == 'key_point' else None
                # Fold in AI-analyst-verified ticker hits (it's better at catching
                # "your NVDA exposure" implicit mentions than the keyword matcher).
                if ai:
                    ai_ticker_hits = [
                        t for t in (ai.get('tickers') or [])
                        if isinstance(t, str) and t.upper() in port_global
                    ]
                    if ai_ticker_hits:
                        holdings_hit = sorted(set(holdings_hit) | {t.upper() for t in ai_ticker_hits})
                out.append({
                    'id': f"{ep['id']}-{kind}-{i}",
                    'episode_id': ep['id'],
                    'episode_title': ep['title'],
                    'source_id': ep['source_id'],
                    'source_name': ep['source_name'],
                    'published_at': ep['published_at'],
                    'url': ep['url'],
                    'kind': kind,
                    'text': text,
                    'people_mentioned': people,
                    'companies_tickers': tickers,
                    'sentiment': ep_sentiment,
                    'llm_verified': is_llm,
                    'holdings_mentioned': holdings_hit,
                    'ai_take': ai['ai_take'] if ai else None,
                    'ai_stance': ai['stance'] if ai else None,
                    'ai_confidence': ai['confidence'] if ai else None,
                    'ai_tickers': ai.get('tickers', []) if ai else [],
                    'ai_portfolio_impact': ai.get('portfolio_impact') if ai else None,
                    'episode_take': episode_take if ai else None,
                    'ai_method': ai_method if ai else None,
                })
            return out

        entries: List[Dict] = (
            build(raw_quotes, 'quote')       # quotes are the juiciest — surface first
            + build(raw_actions, 'action')
            + build(raw_key, 'key_point')
        )

        # Apply filter predicates now so the per-episode cap below is meaningful.
        filtered: List[Dict] = []
        for e in entries:
            if needle_person and not any(needle_person in (p or '').lower() for p in e['people_mentioned']):
                continue
            if needle_ticker and needle_ticker not in e['companies_tickers'] \
                    and needle_ticker not in e['text'].upper():
                continue
            if needle_sent and needle_sent != (e['sentiment'] or ''):
                continue
            if only_mine and not e['holdings_mentioned']:
                continue
            filtered.append(e)

        # At most 3 narratives per episode so one loud show can't dominate but
        # we still surface enough signal when other shows have weak summaries.
        filtered = filtered[:3]
        if filtered:
            per_episode.append((dict(ep), filtered))

    # Round-robin across episodes so adjacent cards come from different shows.
    yielded = 0
    cursors = [0] * len(per_episode)
    while yielded < limit:
        produced_this_round = 0
        for idx in range(len(per_episode)):
            _, items = per_episode[idx]
            cur = cursors[idx]
            if cur >= len(items):
                continue
            yield items[cur]
            cursors[idx] = cur + 1
            yielded += 1
            produced_this_round += 1
            if yielded >= limit:
                return
        if produced_this_round == 0:
            return


def list_narratives(
    limit: int = 50,
    source_id: Optional[int] = None,
    person: Optional[str] = None,
    ticker: Optional[str] = None,
    sentiment: Optional[str] = None,
    only_mine: bool = False,
) -> List[Dict]:
    return list(_iter_narratives(limit, source_id, person, ticker, sentiment, only_mine))


def list_facets() -> Dict[str, List[Dict]]:
    """People + tickers + sources mentioned across the current corpus."""
    with _get_conn() as conn:
        episodes = conn.execute(
            "SELECT id, source_id, summary FROM podbits_episodes "
            "WHERE summary IS NOT NULL AND summary != ''"
        ).fetchall()
        sources = conn.execute(
            "SELECT id, name FROM podbits_sources ORDER BY name ASC"
        ).fetchall()

    people_counter: Dict[str, int] = {}
    ticker_counter: Dict[str, int] = {}
    for ep in episodes:
        summary = _parse_summary(ep['summary']) or {}
        for p in summary.get('people_mentioned') or []:
            if isinstance(p, str) and p.strip():
                people_counter[p.strip()] = people_counter.get(p.strip(), 0) + 1
        for t in summary.get('companies_tickers') or []:
            if isinstance(t, str) and t.strip():
                key = t.strip().upper()
                ticker_counter[key] = ticker_counter.get(key, 0) + 1

    people = sorted(
        ({'name': k, 'count': v} for k, v in people_counter.items()),
        key=lambda x: (-x['count'], x['name']),
    )[:40]
    tickers = sorted(
        ({'ticker': k, 'count': v} for k, v in ticker_counter.items()),
        key=lambda x: (-x['count'], x['ticker']),
    )[:40]
    return {
        'sources': [dict(s) for s in sources],
        'people': people,
        'tickers': tickers,
    }
