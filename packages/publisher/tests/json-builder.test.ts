import { describe, expect, it } from 'vitest';
import type { Article } from '../../../packages/shared/src/types/index.js';
import { buildJsonResponse } from '../src/json-builder.js';

function makeArticle(overrides: Partial<Article> = {}): Article {
	return {
		id: 'test-article-001',
		source: 'hackernews',
		originalUrl: 'https://example.com/article',
		titleEn: 'Test Article English',
		titleJa: 'テスト記事',
		summaryJa: 'これはテスト要約です。',
		importanceScore: 85,
		scoreReason: 'Important technical update',
		tags: ['typescript', 'performance'],
		author: 'Test Author',
		publishedAt: '2026-05-22T06:00:00Z',
		collectedAt: '2026-05-22T07:00:00Z',
		status: 'published',
		retryCount: 0,
		sourceScore: 100,
		createdAt: '2026-05-22T07:00:00Z',
		updatedAt: '2026-05-22T07:00:00Z',
		...overrides,
	};
}

describe('buildJsonResponse', () => {
	it('should return correct top-level shape', () => {
		const result = buildJsonResponse([makeArticle()], { date: '2026-05-22' });

		expect(result).toHaveProperty('data');
		expect(result).toHaveProperty('meta');
		expect(Array.isArray(result.data)).toBe(true);
	});

	it('should populate meta fields', () => {
		const result = buildJsonResponse([makeArticle()], { date: '2026-05-22' });

		expect(result.meta.date).toBe('2026-05-22');
		expect(result.meta.totalCount).toBe(1);
		expect(result.meta.generatedAt).toBeTruthy();
		expect(result.meta.nextUpdate).toBeTruthy();
		// generatedAt and nextUpdate must be ISO 8601
		expect(() => new Date(result.meta.generatedAt)).not.toThrow();
		expect(() => new Date(result.meta.nextUpdate)).not.toThrow();
	});

	it('should map Article to ArticleResponse correctly', () => {
		const article = makeArticle();
		const result = buildJsonResponse([article], { date: '2026-05-22' });
		const item = result.data[0];

		expect(item).toBeDefined();
		if (!item) return;

		expect(item.id).toBe('test-article-001');
		expect(item.source).toBe('hackernews');
		expect(item.originalUrl).toBe('https://example.com/article');
		expect(item.titleJa).toBe('テスト記事');
		expect(item.summaryJa).toBe('これはテスト要約です。');
		expect(item.importanceScore).toBe(85);
		expect(item.tags).toEqual(['typescript', 'performance']);
		expect(item.author).toBe('Test Author');
		expect(item.publishedAt).toBe('2026-05-22T06:00:00Z');
	});

	it('should fall back to titleEn when titleJa is absent', () => {
		const article = makeArticle({ titleJa: undefined });
		const result = buildJsonResponse([article], { date: '2026-05-22' });

		expect(result.data[0]?.titleJa).toBe('Test Article English');
	});

	it('should use empty string for summaryJa when absent', () => {
		const article = makeArticle({ summaryJa: undefined });
		const result = buildJsonResponse([article], { date: '2026-05-22' });

		expect(result.data[0]?.summaryJa).toBe('');
	});

	it('should reflect totalCount correctly for multiple articles', () => {
		const articles = [
			makeArticle({ id: 'art-001' }),
			makeArticle({ id: 'art-002' }),
			makeArticle({ id: 'art-003' }),
		];
		const result = buildJsonResponse(articles, { date: '2026-05-22' });

		expect(result.meta.totalCount).toBe(3);
		expect(result.data.length).toBe(3);
	});

	it('should handle empty array', () => {
		const result = buildJsonResponse([], { date: '2026-05-22' });

		expect(result.data).toEqual([]);
		expect(result.meta.totalCount).toBe(0);
	});

	it('should not include internal Article fields in response', () => {
		const result = buildJsonResponse([makeArticle()], { date: '2026-05-22' });
		const item = result.data[0] as Record<string, unknown>;

		// Internal fields that should NOT be in the response
		expect(item.status).toBeUndefined();
		expect(item.retryCount).toBeUndefined();
		expect(item.errorMessage).toBeUndefined();
		expect(item.collectedAt).toBeUndefined();
		expect(item.createdAt).toBeUndefined();
		expect(item.updatedAt).toBeUndefined();
		expect(item.scoreReason).toBeUndefined();
		expect(item.sourceScore).toBeUndefined();
	});
});
