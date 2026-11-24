/**
 * date-range.ts — UTC の日付（YYYY-MM-DD）を、collected_at の範囲検索用の境界に変える。
 *
 * collected_at は 'YYYY-MM-DD HH:MM:SS'（UTC）で入っている。以前は `date(collected_at) = ?`
 * で絞っていたが、列を関数で包むとインデックスが使えず、毎回 articles を全件読んでいた
 * （2026-11-24 実測 9,571 行）。`collected_at >= 開始 AND collected_at < 翌日` にすると
 * idx_articles_status_collected が効く（同 115 行）。
 *
 * 文字列の比較で正しく働く理由: '2026-11-20 00:00:00' >= '2026-11-20'（長いほうが大きい）、
 * '2026-11-21 00:00:00' < '2026-11-21' は偽。
 */

/** 存在する日付なら [その日, 翌日] を返す。2月30日のような日付は null（以前と同じく 0 件にする）。 */
export function utcDayRange(date: string): [string, string] | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
	const [y, m, d] = date.split('-').map((n) => Number.parseInt(n, 10));
	const start = new Date(Date.UTC(y, m - 1, d));
	if (start.toISOString().slice(0, 10) !== date) return null;
	const next = new Date(start.getTime() + 24 * 60 * 60 * 1000);
	return [date, next.toISOString().slice(0, 10)];
}
