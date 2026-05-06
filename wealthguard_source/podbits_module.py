#!/usr/bin/env python3
"""
PodBits - Podcast/YouTube Transcript Management Module
For WealthGuard - Captures, summarizes, and searches podcast content
"""

import os
import json
import sqlite3
import logging
from datetime import datetime
from typing import List, Dict, Optional, Any
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel

logger = logging.getLogger('podbits')

# Database path
_env_db = os.getenv('DATABASE_PATH', '')
_local_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wealthguard.db')
DB_PATH = _env_db if _env_db and os.path.exists(_env_db) else _local_db


# Pydantic models for API
class PodcastSource(BaseModel):
    id: Optional[int] = None
    name: str
    source_type: str  # 'podcast' or 'youtube'
    url: str
    description: Optional[str] = None
    filter_rules: Optional[str] = None  # JSON string
    is_active: bool = True
    last_checked_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class PodcastEpisode(BaseModel):
    id: Optional[int] = None
    source_id: int
    external_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    url: str
    published_at: Optional[str] = None
    transcript: Optional[str] = None
    summary: Optional[str] = None
    duration_seconds: Optional[int] = None
    is_processed: bool = False
    tags: Optional[List[str]] = None
    source_name: Optional[str] = None  # Joined field
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    ai_analysis: Optional[str] = None
    ai_analysis_at: Optional[str] = None
    audio_url: Optional[str] = None
    is_listened: Optional[int] = 0
    listened_at: Optional[str] = None
    user_rating: Optional[int] = None
    user_notes: Optional[str] = None


class PodcastTag(BaseModel):
    id: Optional[int] = None
    name: str
    description: Optional[str] = None
    color: str = "#3B82F6"
    created_at: Optional[str] = None


class EpisodeSearchResult(BaseModel):
    episode_id: int
    title: str
    summary: Optional[str]
    source_name: str
    published_at: Optional[str]
    tags: List[str]
    relevance_score: float


def get_db_connection():
    """Get database connection with row factory"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_podbits_schema():
    """Initialize PodBits database schema"""
    schema_path = Path(__file__).parent / 'podbits_schema.sql'
    if schema_path.exists():
        with open(schema_path, 'r') as f:
            schema = f.read()
        
        conn = get_db_connection()
        try:
            conn.executescript(schema)
            conn.commit()
            logger.info("PodBits schema initialized successfully")
        finally:
            conn.close()


# ==================== SOURCE CRUD ====================

def create_source(source: PodcastSource) -> PodcastSource:
    """Create a new podcast/YouTube source"""
    conn = get_db_connection()
    try:
        cursor = conn.execute(
            """
            INSERT INTO podbits_sources (name, source_type, url, description, filter_rules, is_active)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (source.name, source.source_type, source.url, source.description,
             source.filter_rules, source.is_active)
        )
        conn.commit()
        source.id = cursor.lastrowid
        return source
    finally:
        conn.close()


def get_source(source_id: int) -> Optional[PodcastSource]:
    """Get a source by ID"""
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT * FROM podbits_sources WHERE id = ?",
            (source_id,)
        ).fetchone()
        if row:
            return PodcastSource(**dict(row))
        return None
    finally:
        conn.close()


def get_all_sources(active_only: bool = False) -> List[PodcastSource]:
    """Get all sources, optionally filtered by active status"""
    conn = get_db_connection()
    try:
        query = "SELECT * FROM podbits_sources"
        if active_only:
            query += " WHERE is_active = 1"
        query += " ORDER BY name"
        
        rows = conn.execute(query).fetchall()
        return [PodcastSource(**dict(row)) for row in rows]
    finally:
        conn.close()


def update_source(source_id: int, source: PodcastSource) -> bool:
    """Update a source"""
    conn = get_db_connection()
    try:
        conn.execute(
            """
            UPDATE podbits_sources
            SET name = ?, source_type = ?, url = ?, description = ?,
                filter_rules = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (source.name, source.source_type, source.url, source.description,
             source.filter_rules, source.is_active, source_id)
        )
        conn.commit()
        return True
    finally:
        conn.close()


def delete_source(source_id: int) -> bool:
    """Delete a source (cascades to episodes)"""
    conn = get_db_connection()
    try:
        conn.execute("DELETE FROM podbits_sources WHERE id = ?", (source_id,))
        conn.commit()
        return True
    finally:
        conn.close()


# ==================== EPISODE CRUD ====================

def create_episode(episode: PodcastEpisode) -> PodcastEpisode:
    """Create a new episode"""
    conn = get_db_connection()
    try:
        cursor = conn.execute(
            """
            INSERT INTO podbits_episodes 
            (source_id, external_id, title, description, url, published_at, 
             transcript, summary, duration_seconds, is_processed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (episode.source_id, episode.external_id, episode.title, episode.description,
             episode.url, episode.published_at, episode.transcript, episode.summary,
             episode.duration_seconds, episode.is_processed)
        )
        conn.commit()
        episode.id = cursor.lastrowid
        return episode
    finally:
        conn.close()


def get_episode(episode_id: int) -> Optional[PodcastEpisode]:
    """Get an episode by ID with tags and source name"""
    conn = get_db_connection()
    try:
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
        
        episode = PodcastEpisode(**dict(row))
        episode.tags = get_episode_tags(episode_id)
        return episode
    finally:
        conn.close()


def get_episodes_by_source(source_id: int, limit: int = 100) -> List[PodcastEpisode]:
    """Get episodes for a specific source"""
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """
            SELECT e.*, s.name as source_name
            FROM podbits_episodes e
            JOIN podbits_sources s ON e.source_id = s.id
            WHERE e.source_id = ?
            ORDER BY e.published_at DESC
            LIMIT ?
            """,
            (source_id, limit)
        ).fetchall()
        
        episodes = []
        for row in rows:
            ep = PodcastEpisode(**dict(row))
            ep.tags = get_episode_tags(ep.id)
            episodes.append(ep)
        return episodes
    finally:
        conn.close()


def get_all_episodes(limit: int = 100, offset: int = 0, 
                     tag_filter: Optional[str] = None) -> List[PodcastEpisode]:
    """Get all episodes with optional tag filter"""
    conn = get_db_connection()
    try:
        if tag_filter:
            rows = conn.execute(
                """
                SELECT e.*, s.name as source_name
                FROM podbits_episodes e
                JOIN podbits_sources s ON e.source_id = s.id
                JOIN podbits_episode_tags et ON e.id = et.episode_id
                JOIN podbits_tags t ON et.tag_id = t.id
                WHERE t.name = ?
                ORDER BY e.published_at DESC
                LIMIT ? OFFSET ?
                """,
                (tag_filter, limit, offset)
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT e.*, s.name as source_name
                FROM podbits_episodes e
                JOIN podbits_sources s ON e.source_id = s.id
                ORDER BY e.published_at DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset)
            ).fetchall()
        
        episodes = []
        for row in rows:
            ep = PodcastEpisode(**dict(row))
            ep.tags = get_episode_tags(ep.id)
            episodes.append(ep)
        return episodes
    finally:
        conn.close()


def update_episode(episode_id: int, episode: PodcastEpisode) -> bool:
    """Update an episode"""
    conn = get_db_connection()
    try:
        conn.execute(
            """
            UPDATE podbits_episodes
            SET title = ?, description = ?, url = ?, published_at = ?,
                transcript = ?, summary = ?, duration_seconds = ?, 
                is_processed = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (episode.title, episode.description, episode.url, episode.published_at,
             episode.transcript, episode.summary, episode.duration_seconds,
             episode.is_processed, episode_id)
        )
        conn.commit()
        return True
    finally:
        conn.close()


def delete_episode(episode_id: int) -> bool:
    """Delete an episode"""
    conn = get_db_connection()
    try:
        conn.execute("DELETE FROM podbits_episodes WHERE id = ?", (episode_id,))
        conn.commit()
        return True
    finally:
        conn.close()


# ==================== TAGS ====================

def create_tag(tag: PodcastTag) -> PodcastTag:
    """Create a new tag"""
    conn = get_db_connection()
    try:
        cursor = conn.execute(
            "INSERT INTO podbits_tags (name, description, color) VALUES (?, ?, ?)",
            (tag.name, tag.description, tag.color)
        )
        conn.commit()
        tag.id = cursor.lastrowid
        return tag
    except sqlite3.IntegrityError:
        # Tag already exists, fetch it
        row = conn.execute(
            "SELECT * FROM podbits_tags WHERE name = ?",
            (tag.name,)
        ).fetchone()
        return PodcastTag(**dict(row))
    finally:
        conn.close()


def get_all_tags() -> List[PodcastTag]:
    """Get all tags"""
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """
            SELECT t.id, t.name, t.description, 
                   COALESCE(t.color, '#3B82F6') as color,
                   COUNT(et.episode_id) as episode_count
            FROM podbits_tags t
            LEFT JOIN podbits_episode_tags et ON t.id = et.tag_id
            GROUP BY t.id
            ORDER BY episode_count DESC, t.name
            """
        ).fetchall()
        return [PodcastTag(**dict(row)) for row in rows]
    finally:
        conn.close()


def get_episode_tags(episode_id: int) -> List[str]:
    """Get tag names for an episode"""
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """
            SELECT t.name
            FROM podbits_tags t
            JOIN podbits_episode_tags et ON t.id = et.tag_id
            WHERE et.episode_id = ?
            ORDER BY t.name
            """,
            (episode_id,)
        ).fetchall()
        return [row['name'] for row in rows]
    finally:
        conn.close()


def add_tag_to_episode(episode_id: int, tag_id: int):
    """Add a tag to an episode"""
    conn = get_db_connection()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO podbits_episode_tags (episode_id, tag_id) VALUES (?, ?)",
            (episode_id, tag_id)
        )
        conn.commit()
    finally:
        conn.close()


def remove_tag_from_episode(episode_id: int, tag_id: int):
    """Remove a tag from an episode"""
    conn = get_db_connection()
    try:
        conn.execute(
            "DELETE FROM podbits_episode_tags WHERE episode_id = ? AND tag_id = ?",
            (episode_id, tag_id)
        )
        conn.commit()
    finally:
        conn.close()


# ==================== SEARCH ====================

def search_episodes(query: str, limit: int = 20) -> List[EpisodeSearchResult]:
    """Full-text search across episodes"""
    conn = get_db_connection()
    try:
        # Use FTS5 for full-text search
        rows = conn.execute(
            """
            SELECT 
                e.id as episode_id,
                e.title,
                e.summary,
                s.name as source_name,
                e.published_at,
                rank as relevance_score
            FROM podbits_search
            JOIN podbits_episodes e ON podbits_search.episode_id = e.id
            JOIN podbits_sources s ON e.source_id = s.id
            WHERE podbits_search MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (query, limit)
        ).fetchall()
        
        results = []
        for row in rows:
            result = EpisodeSearchResult(
                episode_id=row['episode_id'],
                title=row['title'],
                summary=row['summary'],
                source_name=row['source_name'],
                published_at=row['published_at'],
                tags=get_episode_tags(row['episode_id']),
                relevance_score=abs(row['relevance_score']) if row['relevance_score'] else 0
            )
            results.append(result)
        return results
    finally:
        conn.close()


def search_by_keyword(keyword: str, limit: int = 20) -> List[PodcastEpisode]:
    """Simple keyword search (fallback for FTS)"""
    conn = get_db_connection()
    try:
        pattern = f"%{keyword}%"
        rows = conn.execute(
            """
            SELECT e.*, s.name as source_name
            FROM podbits_episodes e
            JOIN podbits_sources s ON e.source_id = s.id
            WHERE e.title LIKE ? OR e.summary LIKE ? OR e.transcript LIKE ?
            ORDER BY e.published_at DESC
            LIMIT ?
            """,
            (pattern, pattern, pattern, limit)
        ).fetchall()
        
        episodes = []
        for row in rows:
            ep = PodcastEpisode(**dict(row))
            ep.tags = get_episode_tags(ep.id)
            episodes.append(ep)
        return episodes
    finally:
        conn.close()


# ==================== DEFAULT SOURCES ====================

def seed_default_sources():
    """Seed the database with the user's requested sources"""
    default_sources = [
        {
            "name": "All-In with Chamath, Jason, Sacks & Friedberg",
            "source_type": "podcast",
            "url": "https://podcasts.apple.com/us/podcast/all-in-with-chamath-jason-sacks-friedberg/id1502871393",
            "description": "The All-In Podcast - Besties Chamath Palihapitiya, Jason Calacanis, David Sacks, and David Friedberg cover all things economic, tech, political, social, and poker.",
            "filter_rules": None
        },
        {
            "name": "Moonshots with Peter Diamandis",
            "source_type": "podcast",
            "url": "https://podcasts.apple.com/us/podcast/moonshots-with-peter-diamandis/id1648228034",
            "description": "Peter Diamandis discusses the future of technology, longevity, space, and abundance.",
            "filter_rules": None
        },
        {
            "name": "Prof G Markets",
            "source_type": "podcast",
            "url": "https://podcasts.apple.com/us/podcast/prof-g-markets/id1744631325",
            "description": "Scott Galloway on markets, business, and the economy.",
            "filter_rules": None
        },
        {
            "name": "China Decode",
            "source_type": "podcast",
            "url": "https://podcasts.apple.com/us/podcast/china-decode-china-walks-a-dangerous-line-as-iran/id1498802610",
            "description": "Analysis of China business, politics, and economic developments.",
            "filter_rules": json.dumps(["China Decode"])  # Only episodes with this in title
        }
    ]
    
    conn = get_db_connection()
    try:
        for source_data in default_sources:
            # Check if source already exists
            existing = conn.execute(
                "SELECT id FROM podbits_sources WHERE url = ?",
                (source_data["url"],)
            ).fetchone()
            
            if not existing:
                conn.execute(
                    """
                    INSERT INTO podbits_sources (name, source_type, url, description, filter_rules, is_active)
                    VALUES (?, ?, ?, ?, ?, 1)
                    """,
                    (source_data["name"], source_data["source_type"], source_data["url"],
                     source_data["description"], source_data["filter_rules"])
                )
                logger.info(f"Added source: {source_data['name']}")
        
        conn.commit()
    finally:
        conn.close()


# Initialize on module load
init_podbits_schema()
