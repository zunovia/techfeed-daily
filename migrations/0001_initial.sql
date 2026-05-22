-- /migrations/0001_initial.sql

CREATE TABLE articles (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  original_url  TEXT NOT NULL UNIQUE,
  title_en      TEXT NOT NULL,
  title_ja      TEXT,
  summary_ja    TEXT,
  importance_score INTEGER DEFAULT 0,
  score_reason  TEXT,
  tags          TEXT,
  author        TEXT,
  published_at  TEXT NOT NULL,
  collected_at  TEXT NOT NULL DEFAULT (datetime('now')),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','summarizing','published','failed','skipped')),
  retry_count   INTEGER DEFAULT 0,
  error_message TEXT,
  source_score  INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_articles_status      ON articles(status);
CREATE INDEX idx_articles_published   ON articles(published_at DESC);
CREATE INDEX idx_articles_importance  ON articles(importance_score DESC);
CREATE INDEX idx_articles_source      ON articles(source, published_at DESC);

CREATE TABLE daily_digests (
  date          TEXT PRIMARY KEY,
  article_ids   TEXT NOT NULL,
  generated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  rss_size_bytes INTEGER DEFAULT 0,
  article_count INTEGER DEFAULT 0
);

CREATE TABLE api_keys (
  key_hash      TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  tier          TEXT NOT NULL DEFAULT 'free'
                CHECK(tier IN ('free','pro')),
  rate_limit_per_hour INTEGER DEFAULT 60,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT
);

CREATE TABLE collection_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT NOT NULL,
  source        TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  articles_found    INTEGER DEFAULT 0,
  articles_saved    INTEGER DEFAULT 0,
  articles_skipped  INTEGER DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK(status IN ('running','success','partial','failed')),
  error_message TEXT
);
