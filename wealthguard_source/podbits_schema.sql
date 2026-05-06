-- PodBits Database Schema
-- Podcast/YouTube transcript management for WealthGuard

-- Podcast/YouTube sources
CREATE TABLE IF NOT EXISTS podbits_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('podcast', 'youtube')),
    url TEXT NOT NULL,
    description TEXT,
    filter_rules TEXT, -- JSON array for filtering (e.g., ["China Decode"])
    is_active BOOLEAN DEFAULT 1,
    last_checked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Individual episodes/videos
CREATE TABLE IF NOT EXISTS podbits_episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    external_id TEXT, -- Apple Podcast ID, YouTube video ID, etc.
    title TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    published_at TIMESTAMP,
    transcript TEXT,
    summary TEXT,
    duration_seconds INTEGER,
    is_processed BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES podbits_sources(id) ON DELETE CASCADE
);

-- Tags for episodes
CREATE TABLE IF NOT EXISTS podbits_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT DEFAULT '#3B82F6',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Episode-Tag relationship
CREATE TABLE IF NOT EXISTS podbits_episode_tags (
    episode_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (episode_id, tag_id),
    FOREIGN KEY (episode_id) REFERENCES podbits_episodes(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES podbits_tags(id) ON DELETE CASCADE
);

-- Search index (for full-text search)
CREATE VIRTUAL TABLE IF NOT EXISTS podbits_search USING fts5(
    episode_id,
    title,
    summary,
    transcript,
    content='podbits_episodes',
    content_rowid='id'
);

-- Triggers to keep search index in sync
CREATE TRIGGER IF NOT EXISTS podbits_episodes_insert AFTER INSERT ON podbits_episodes BEGIN
    INSERT INTO podbits_search(episode_id, title, summary, transcript)
    VALUES (new.id, new.title, new.summary, new.transcript);
END;

CREATE TRIGGER IF NOT EXISTS podbits_episodes_update AFTER UPDATE ON podbits_episodes BEGIN
    UPDATE podbits_search SET
        title = new.title,
        summary = new.summary,
        transcript = new.transcript
    WHERE episode_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS podbits_episodes_delete AFTER DELETE ON podbits_episodes BEGIN
    DELETE FROM podbits_search WHERE episode_id = old.id;
END;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_episodes_source ON podbits_episodes(source_id);
CREATE INDEX IF NOT EXISTS idx_episodes_published ON podbits_episodes(published_at);
CREATE INDEX IF NOT EXISTS idx_episodes_processed ON podbits_episodes(is_processed);
