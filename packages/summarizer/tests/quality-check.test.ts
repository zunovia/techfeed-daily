import type { ClaudeSummaryOutput } from '@techfeed/shared';
import { describe, expect, it } from 'vitest';
import { checkSummaryQuality, QUALITY_PASS_THRESHOLD } from '../src/quality-check.js';

/**
 * Build a valid ClaudeSummaryOutput for testing.
 */
// A 370-character Japanese summary (within the 350-430 char valid range)
const VALID_SUMMARY_JA =
	'TypeScript 5.5がリリースされ、推論パフォーマンスが最大20%向上した。新機能として制御フロー分析の改善と型推論の最適化が含まれる。特にユニオン型を多用するコードベースでの恩恵が大きく、大規模プロジェクトではビルド時間の短縮が期待できる。実務においてはtsconfig.jsonのstrict設定を維持しつつ、新しい型ナロウイング機能を活用することで保守性の高いコードが書けるようになった。マイグレーションは既存コードとの後方互換性が保たれており、npmのアップデートのみで利用可能だ。この変更により開発効率が大幅に改善され、チームの生産性向上に直結すると期待されている。新しいAPIも追加されており、より柔軟な型定義が可能となった。エンジニアにとって注目すべき重要なリリースと言えるだろう。今後のアップデートにも期待が高まる。';

function validSummary(overrides: Partial<ClaudeSummaryOutput> = {}): ClaudeSummaryOutput {
	return {
		titleJa: 'TypeScriptの新機能でパフォーマンスが大幅向上',
		summaryJa: VALID_SUMMARY_JA,
		importanceScore: 75,
		scoreReason: 'TypeScriptのメジャーアップデートで実務への影響が大きい',
		tags: ['typescript', 'performance'],
		...overrides,
	};
}

describe('checkSummaryQuality', () => {
	describe('passing cases', () => {
		it('returns passed=true for a valid summary', () => {
			const result = checkSummaryQuality(validSummary());
			expect(result.passed).toBe(true);
			expect(result.score).toBeGreaterThanOrEqual(QUALITY_PASS_THRESHOLD);
			expect(result.failures).toHaveLength(0);
		});

		it('scores 100 when all checks pass', () => {
			const result = checkSummaryQuality(validSummary());
			expect(result.score).toBe(100);
		});
	});

	describe('summaryJa length check', () => {
		it('fails when summary is too short (< 350 chars)', () => {
			const result = checkSummaryQuality(validSummary({ summaryJa: '短い要約です。' }));
			expect(result.failures.some((f) => f.includes('summaryJa length'))).toBe(true);
		});

		it('fails when summary is too long (> 430 chars)', () => {
			// 431 Japanese characters
			const longSummary = 'あ'.repeat(431);
			const result = checkSummaryQuality(validSummary({ summaryJa: longSummary }));
			expect(result.failures.some((f) => f.includes('summaryJa length'))).toBe(true);
		});

		it('passes at exactly 350 chars', () => {
			const summary350 = 'あ'.repeat(350);
			const result = checkSummaryQuality(validSummary({ summaryJa: summary350 }));
			expect(result.failures.some((f) => f.includes('summaryJa length'))).toBe(false);
		});

		it('passes at exactly 430 chars', () => {
			const summary430 = 'あ'.repeat(430);
			const result = checkSummaryQuality(validSummary({ summaryJa: summary430 }));
			expect(result.failures.some((f) => f.includes('summaryJa length'))).toBe(false);
		});
	});

	describe('Japanese ratio check', () => {
		it('fails when Japanese ratio is below 30%', () => {
			// Mostly ASCII - well below 30% Japanese
			const asciiSummary = 'a'.repeat(350);
			const result = checkSummaryQuality(validSummary({ summaryJa: asciiSummary }));
			expect(result.failures.some((f) => f.includes('Japanese ratio'))).toBe(true);
		});

		it('passes when Japanese ratio is exactly 30%', () => {
			// 30% Japanese (105 chars) + 70% ASCII (245 chars) = 350 total
			const mixedSummary = 'あ'.repeat(105) + 'a'.repeat(245);
			const result = checkSummaryQuality(validSummary({ summaryJa: mixedSummary }));
			expect(result.failures.some((f) => f.includes('Japanese ratio'))).toBe(false);
		});

		it('passes for all-Japanese text', () => {
			const japaneseSummary = 'あ'.repeat(380);
			const result = checkSummaryQuality(validSummary({ summaryJa: japaneseSummary }));
			expect(result.failures.some((f) => f.includes('Japanese ratio'))).toBe(false);
		});
	});

	describe('importanceScore check', () => {
		it('fails when score is 0', () => {
			const result = checkSummaryQuality(validSummary({ importanceScore: 0 }));
			expect(result.failures.some((f) => f.includes('importanceScore'))).toBe(true);
		});

		it('fails when score is 101', () => {
			const result = checkSummaryQuality(validSummary({ importanceScore: 101 }));
			expect(result.failures.some((f) => f.includes('importanceScore'))).toBe(true);
		});

		it('fails when score is negative', () => {
			const result = checkSummaryQuality(validSummary({ importanceScore: -1 }));
			expect(result.failures.some((f) => f.includes('importanceScore'))).toBe(true);
		});

		it('passes at score=1 (minimum)', () => {
			const result = checkSummaryQuality(validSummary({ importanceScore: 1 }));
			expect(result.failures.some((f) => f.includes('importanceScore'))).toBe(false);
		});

		it('passes at score=100 (maximum)', () => {
			const result = checkSummaryQuality(validSummary({ importanceScore: 100 }));
			expect(result.failures.some((f) => f.includes('importanceScore'))).toBe(false);
		});

		it('fails for non-integer scores', () => {
			const result = checkSummaryQuality(validSummary({ importanceScore: 75.5 }));
			expect(result.failures.some((f) => f.includes('importanceScore'))).toBe(true);
		});
	});

	describe('titleJa length check', () => {
		it('fails when title exceeds 45 chars', () => {
			const result = checkSummaryQuality(validSummary({ titleJa: 'あ'.repeat(46) }));
			expect(result.failures.some((f) => f.includes('titleJa length'))).toBe(true);
		});

		it('passes at exactly 45 chars', () => {
			const result = checkSummaryQuality(validSummary({ titleJa: 'あ'.repeat(45) }));
			expect(result.failures.some((f) => f.includes('titleJa length'))).toBe(false);
		});

		it('passes with a short title', () => {
			const result = checkSummaryQuality(validSummary({ titleJa: 'タイトル' }));
			expect(result.failures.some((f) => f.includes('titleJa length'))).toBe(false);
		});

		it('fails for empty title', () => {
			const result = checkSummaryQuality(validSummary({ titleJa: '' }));
			expect(result.failures.some((f) => f.includes('titleJa length'))).toBe(true);
		});
	});

	describe('tags check', () => {
		it('fails when tags is empty array', () => {
			const result = checkSummaryQuality(validSummary({ tags: [] }));
			expect(result.failures.some((f) => f.includes('tags'))).toBe(true);
		});

		it('passes with a single tag', () => {
			const result = checkSummaryQuality(validSummary({ tags: ['typescript'] }));
			expect(result.failures.some((f) => f.includes('tags'))).toBe(false);
		});

		it('passes with multiple tags', () => {
			const result = checkSummaryQuality(validSummary({ tags: ['react', 'performance', 'hooks'] }));
			expect(result.failures.some((f) => f.includes('tags'))).toBe(false);
		});
	});

	describe('scoring and pass threshold', () => {
		it('score is 80 when 4 out of 5 checks pass', () => {
			// Only tags check fails
			const result = checkSummaryQuality(validSummary({ tags: [] }));
			expect(result.score).toBe(80);
		});

		it('score is 60 when 3 out of 5 checks pass (fails threshold)', () => {
			// title too long + tags empty = 2 failures
			const result = checkSummaryQuality(validSummary({ titleJa: 'あ'.repeat(46), tags: [] }));
			expect(result.score).toBe(60);
			expect(result.passed).toBe(false);
		});

		it('QUALITY_PASS_THRESHOLD is 70', () => {
			expect(QUALITY_PASS_THRESHOLD).toBe(70);
		});

		it('score is 0 when all checks fail', () => {
			const result = checkSummaryQuality({
				titleJa: 'あ'.repeat(46),
				summaryJa: 'short',
				importanceScore: 0,
				scoreReason: 'reason',
				tags: [],
			});
			expect(result.score).toBe(0);
			expect(result.passed).toBe(false);
		});
	});
});
