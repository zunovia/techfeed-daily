/**
 * sql-index-guard.test.ts — インデックスが効かない SQL を CI で止める。
 *
 * 2026-11-24、D1 無料枠（1 日 500 万行の読み取り）の 80% に達した。原因は
 * `WHERE ... date(collected_at) = ?` のように列を関数で包んだ条件で、インデックスが使えず
 * 1 回の表示で articles をほぼ全件（約 1 万行）読んでいたこと。
 * 列は関数で包まず、範囲で絞る（例: collected_at >= ? AND collected_at < ?。lib/date-range.ts）。
 *
 * 全パッケージの src を読み、WHERE / AND / OR の直後に「関数(列名」が来る書き方を探す。
 * SELECT・GROUP BY・ORDER BY での関数（表示や集計）は対象外。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGES = join(__dirname, '..', '..');
const FUNCS = 'date|datetime|strftime|julianday|substr|substring|lower|upper|trim|ifnull|coalesce';
// 例: "WHERE date(collected_at) = ?"、"AND lower(title_en) LIKE ?"、"AND (strftime('%Y', col) = ?"
// 右辺の "collected_at >= datetime('now', ...)" は列を包んでいないので対象外。
const BAD = new RegExp(
	String.raw`\b(?:WHERE|AND|OR|ON|HAVING)\s+(?:NOT\s+)?\(*\s*(?:${FUNCS})\s*\(\s*(?:'[^']*'\s*,\s*)?[a-z_][a-z0-9_.]*\s*[,)]`,
	'gi',
);

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
		else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
	}
	return out;
}

describe('SQL がインデックスを使える形で書かれている', () => {
	const files = readdirSync(PACKAGES)
		.map((pkg) => join(PACKAGES, pkg, 'src'))
		.filter((p) => {
			try {
				return statSync(p).isDirectory();
			} catch {
				return false;
			}
		})
		.flatMap(sourceFiles);

	it('対象のソースを読めている', () => {
		expect(files.length).toBeGreaterThan(5);
	});

	it('WHERE で列を関数で包んでいない（date(列) = ? などは範囲指定に書き換える）', () => {
		const hits: string[] = [];
		for (const f of files) {
			const text = readFileSync(f, 'utf8');
			for (const m of text.matchAll(BAD)) {
				const line = text.slice(0, m.index).split('\n').length;
				hits.push(`${relative(PACKAGES, f)}:${line}  ${m[0]}`);
			}
		}
		expect(hits).toEqual([]);
	});

	it('検出の仕組み自体が働く（旧来の書き方を検出できる）', () => {
		const old = "WHERE status = 'published'\n AND date(collected_at) = ?";
		expect(old.match(BAD)).not.toBeNull();
		const ok = "WHERE status = 'published' AND collected_at >= ? AND collected_at < ?";
		expect(ok.match(BAD)).toBeNull();
		const select = 'SELECT date(collected_at) AS date FROM articles GROUP BY date(collected_at)';
		expect(select.match(BAD)).toBeNull();
		expect("AND collected_at >= datetime('now', '-24 hours')".match(BAD)).toBeNull();
		for (const bad of [
			"WHERE strftime('%Y-%m-%d', collected_at) = ?",
			'WHERE (date(collected_at) = ?)',
			'AND NOT date(collected_at) = ?',
			'HAVING date(collected_at) = ?',
			'where\n  LOWER( title_en ) like ?',
		]) {
			expect(bad.match(BAD), bad).not.toBeNull();
		}
	});
});
