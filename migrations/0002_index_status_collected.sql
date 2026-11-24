-- /migrations/0002_index_status_collected.sql
--
-- サイト・API・RSS・publisher は、どれも「status = 'published' かつ collected_at の範囲」で記事を探す。
-- collected_at にインデックスが無く、1 回の表示で articles をほぼ全件読んでいた
-- （2026-11-24 実測: トップ 9,515 行、日付ページ 9,571 行、アーカイブ・sitemap 16,078 行）。
-- D1 無料枠の 1 日 500 万行の 80% に達したため追加する。既存のデータは変えない。

CREATE INDEX IF NOT EXISTS idx_articles_status_collected ON articles(status, collected_at);
