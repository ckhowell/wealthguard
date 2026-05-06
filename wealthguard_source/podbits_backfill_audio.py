#!/usr/bin/env python3
"""One-shot: backfill podbits_episodes.audio_url from current RSS feeds.

Matches existing DB rows to RSS items by external_id first (guid/Apple ID),
then falls back to exact title match. Logs counts per source and exits.
"""
from __future__ import annotations
import os, sqlite3, logging

from podbits_ingest import (
    extract_podcast_id_from_apple_url,
    get_rss_feed_from_apple,
    parse_rss_feed,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger('podbits.backfill_audio')

DB_PATH = os.getenv('DATABASE_PATH') or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'wealthguard.db'
)


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    sources = conn.execute(
        "SELECT id, name, source_type, url, filter_rules FROM podbits_sources WHERE is_active = 1"
    ).fetchall()

    grand_total = 0
    for src in sources:
        rss_url = src['url']
        if src['source_type'] == 'podcast':
            pid = extract_podcast_id_from_apple_url(src['url'])
            if pid:
                resolved = get_rss_feed_from_apple(pid)
                if resolved:
                    rss_url = resolved
        try:
            import json as _json
            filters = _json.loads(src['filter_rules']) if src['filter_rules'] else None
        except Exception:
            filters = None

        episodes = parse_rss_feed(rss_url, filters) if rss_url else []
        if not episodes:
            logger.warning("No RSS episodes for %s", src['name'])
            continue

        by_ext = {e.external_id: e for e in episodes if e.external_id}
        by_title = {e.title.strip().lower(): e for e in episodes if e.title}

        rows = conn.execute(
            "SELECT id, external_id, title FROM podbits_episodes "
            "WHERE source_id = ? AND (audio_url IS NULL OR audio_url = '')",
            (src['id'],),
        ).fetchall()

        updated = 0
        for r in rows:
            match = by_ext.get(r['external_id']) if r['external_id'] else None
            if not match:
                match = by_title.get((r['title'] or '').strip().lower())
            if match and match.audio_url:
                conn.execute(
                    "UPDATE podbits_episodes SET audio_url = ? WHERE id = ?",
                    (match.audio_url, r['id']),
                )
                updated += 1
        conn.commit()
        grand_total += updated
        logger.info("%s: backfilled %d/%d", src['name'], updated, len(rows))

    logger.info("Total backfilled: %d", grand_total)
    conn.close()


if __name__ == '__main__':
    main()
