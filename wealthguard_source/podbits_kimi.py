#!/usr/bin/env python3
"""
PodBits — simple, Kimi-powered pipeline.

For each active source in podbits_sources:
  1. Pull RSS, take the single latest episode.
  2. If already in DB, skip.
  3. Send title + description (+ transcript if RSS includes one) to Kimi K2.6,
     asking for brief summary, key points, and an analyst take in one JSON blob.
  4. Insert episode row with summary JSON and ai_analysis JSON populated.

Designed to be re-run safely — idempotent via external_id.

Usage:
    python3 podbits_kimi.py              # process latest per active source
    python3 podbits_kimi.py --source 3   # just that source
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Optional

from podbits_ingest import (
    extract_podcast_id_from_apple_url,
    get_rss_feed_from_apple,
    parse_rss_feed,
    RawEpisode,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("podbits.kimi")

HERE = Path(__file__).parent
DB_PATH = os.getenv("DATABASE_PATH") or str(HERE / "wealthguard.db")


# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------
def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def _active_sources(source_id: Optional[int] = None) -> list[dict]:
    with _conn() as c:
        if source_id is not None:
            rows = c.execute(
                "SELECT * FROM podbits_sources WHERE id = ? AND is_active = 1",
                (source_id,),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM podbits_sources WHERE is_active = 1"
            ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# RSS -> latest episode
# ---------------------------------------------------------------------------
def latest_episode(source: dict) -> Optional[RawEpisode]:
    if source["source_type"] != "podcast":
        log.warning("source %s not a podcast — skipping", source["name"])
        return None

    podcast_id = extract_podcast_id_from_apple_url(source["url"])
    if podcast_id:
        rss = get_rss_feed_from_apple(podcast_id)
    else:
        rss = source["url"]
    if not rss:
        log.error("no RSS for %s", source["name"])
        return None

    episodes = parse_rss_feed(rss)
    if not episodes:
        return None

    def _pub_key(e: RawEpisode) -> datetime:
        raw = (e.published_at or "").strip()
        if not raw:
            return datetime.min.replace(tzinfo=timezone.utc)
        try:
            dt = parsedate_to_datetime(raw)
        except (TypeError, ValueError):
            try:
                dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except ValueError:
                return datetime.min.replace(tzinfo=timezone.utc)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt

    episodes.sort(key=_pub_key, reverse=True)
    return episodes[0]


# ---------------------------------------------------------------------------
# Kimi — one call, returns summary + analyst take
# ---------------------------------------------------------------------------
PROMPT = """You are a finance-markets analyst consuming a podcast episode.
Reply with PURE JSON (no markdown fences) in this schema:

{
  "brief_summary": "<2-4 sentences — what the episode is actually about>",
  "key_points": ["<key claim 1>", "<key claim 2>", "..."],
  "tickers": ["<UPPERCASE tickers mentioned>", "..."],
  "analyst_take": {
    "episode_take": "<1-3 sentence critical POV on the episode>",
    "pod_takes": [
      {
        "pod_take_idx": 0,
        "stance": "agrees" | "disagrees" | "context" | "caution",
        "confidence": "high" | "medium" | "low",
        "ai_take": "<1-2 sentence analyst commentary on key_points[0]>",
        "tickers": ["..."],
        "portfolio_impact": null
      }
    ]
  }
}

Rules:
- Aim for 4-8 key_points. One analyst pod_take per key_point, in order.
- Use null for portfolio_impact unless the claim clearly impacts a diversified AU investor.
- Avoid boilerplate. Be pragmatic. Do not cheerlead.

EPISODE: __TITLE__
SOURCE : __SOURCE__
DESCRIPTION:
__DESCRIPTION__

TRANSCRIPT (may be empty or truncated):
__TRANSCRIPT__
"""


def _kimi_call(prompt: str) -> Optional[str]:
    key = os.getenv("KIMI_API_KEY")
    if not key:
        log.error("KIMI_API_KEY missing")
        return None
    try:
        from openai import OpenAI
    except ImportError:
        log.error("openai package not installed")
        return None
    client = OpenAI(
        api_key=key,
        base_url=os.getenv("KIMI_BASE_URL", "https://api.moonshot.ai/v1"),
    )
    try:
        resp = client.chat.completions.create(
            model=os.getenv("KIMI_MODEL", "kimi-k2.6"),
            messages=[{"role": "user", "content": prompt}],
            temperature=1,
            max_tokens=6000,
        )
        return resp.choices[0].message.content
    except Exception as e:
        log.error("Kimi call failed: %s", e)
        return None


def _parse_json(raw: str) -> Optional[dict]:
    if not raw:
        return None
    txt = raw.strip()
    if txt.startswith("```"):
        txt = re.sub(r"^```(?:json)?\s*", "", txt)
        txt = re.sub(r"\s*```\s*$", "", txt)
    i, j = txt.find("{"), txt.rfind("}")
    if i < 0 or j < i:
        return None
    try:
        return json.loads(txt[i : j + 1])
    except json.JSONDecodeError as e:
        log.warning("JSON parse failed: %s", e)
        return None


def analyse(ep: RawEpisode, source_name: str) -> Optional[dict]:
    transcript = (ep.transcript_text or "")[:80_000]
    prompt = (
        PROMPT.replace("__TITLE__", ep.title or "")
        .replace("__SOURCE__", source_name)
        .replace("__DESCRIPTION__", (ep.description or "").strip())
        .replace("__TRANSCRIPT__", transcript)
    )
    raw = _kimi_call(prompt)
    if not raw:
        return None
    parsed = _parse_json(raw)
    if not parsed:
        log.warning("Kimi returned unparseable: %s", (raw or "")[:200])
        return None
    return parsed


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------
def ingest_source(source: dict) -> dict:
    ep = latest_episode(source)
    if not ep:
        return {"source": source["name"], "status": "no-episode"}

    with _conn() as c:
        existing = c.execute(
            "SELECT id FROM podbits_episodes WHERE external_id = ? OR (source_id = ? AND title = ?)",
            (ep.external_id, source["id"], ep.title),
        ).fetchone()
    if existing:
        return {"source": source["name"], "status": "already-ingested", "title": ep.title}

    parsed = analyse(ep, source["name"])
    if not parsed:
        return {"source": source["name"], "status": "kimi-failed", "title": ep.title}

    summary_json = {
        "brief_summary": (parsed.get("brief_summary") or "").strip(),
        "key_points": [p for p in (parsed.get("key_points") or []) if isinstance(p, str)][:10],
        "tickers": [str(t).upper() for t in (parsed.get("tickers") or []) if t][:12],
    }
    analyst = parsed.get("analyst_take") or {}
    analyst_json = {
        "episode_take": (analyst.get("episode_take") or "").strip(),
        "pod_takes": analyst.get("pod_takes") or [],
        "method": "kimi",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    with _conn() as c:
        c.execute(
            """
            INSERT INTO podbits_episodes
              (source_id, external_id, title, description, url, audio_url,
               published_at, transcript, summary, ai_analysis, ai_analysis_at,
               duration_seconds, is_processed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (
                source["id"],
                ep.external_id,
                ep.title,
                ep.description,
                ep.url,
                ep.audio_url,
                ep.published_at,
                ep.transcript_text,
                json.dumps(summary_json),
                json.dumps(analyst_json),
                analyst_json["generated_at"],
                ep.duration_seconds,
            ),
        )
        c.execute(
            "UPDATE podbits_sources SET last_checked_at = CURRENT_TIMESTAMP WHERE id = ?",
            (source["id"],),
        )
        c.commit()

    return {
        "source": source["name"],
        "status": "ok",
        "title": ep.title,
        "key_points": len(summary_json["key_points"]),
        "pod_takes": len(analyst_json["pod_takes"]),
    }


def run(source_id: Optional[int] = None) -> list[dict]:
    results = []
    for s in _active_sources(source_id):
        log.info("ingesting %s", s["name"])
        try:
            results.append(ingest_source(s))
        except Exception as e:
            log.exception("source %s failed", s["name"])
            results.append({"source": s["name"], "status": "error", "error": str(e)})
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=int, help="Single source id")
    args = parser.parse_args()
    out = run(args.source)
    print(json.dumps(out, indent=2))
