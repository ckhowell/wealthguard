-- Fix FTS5 triggers - the content_rowid requires special handling
-- Drop old triggers if they exist
DROP TRIGGER IF EXISTS podbits_episodes_insert;
DROP TRIGGER IF EXISTS podbits_episodes_update;
DROP TRIGGER IF EXISTS podbits_episodes_delete;

-- Recreate search table if needed (data will be lost but will be rebuilt)
DROP TABLE IF EXISTS podbits_search;

-- Search index (for full-text search) - external content table
CREATE VIRTUAL TABLE IF NOT EXISTS podbits_search USING fts5(
    title,
    summary,
    transcript,
    content='podbits_episodes',
    content_rowid='id'
);

-- Triggers to keep search index in sync
CREATE TRIGGER IF NOT EXISTS podbits_episodes_insert AFTER INSERT ON podbits_episodes BEGIN
    INSERT INTO podbits_search(rowid, title, summary, transcript)
    VALUES (new.id, new.title, new.summary, new.transcript);
END;

CREATE TRIGGER IF NOT EXISTS podbits_episodes_update AFTER UPDATE ON podbits_episodes BEGIN
    UPDATE podbits_search SET
        title = new.title,
        summary = new.summary,
        transcript = new.transcript
    WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS podbits_episodes_delete AFTER DELETE ON podbits_episodes BEGIN
    DELETE FROM podbits_search WHERE rowid = old.id;
END;

-- Rebuild search index
INSERT INTO podbits_search(rowid, title, summary, transcript)
SELECT id, title, summary, transcript FROM podbits_episodes;
