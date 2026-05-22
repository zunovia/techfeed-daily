import type { RawArticle } from '@techfeed/shared';
import { describe, expect, it } from 'vitest';
import { filterArticles } from '../src/filter.js';

const makeArticle = (overrides: Partial<RawArticle> = {}): RawArticle => ({
	id: 'test_1',
	source: 'hackernews',
	originalUrl: 'https://example.com/article',
	titleEn: 'Test Article',
	publishedAt: '2026-05-22T00:00:00Z',
	sourceScore: 50,
	...overrides,
});

describe('filterArticles', () => {
	it('keeps articles above HN score threshold', () => {
		const articles = [makeArticle({ sourceScore: 15 })];
		expect(filterArticles(articles)).toHaveLength(1);
	});

	it('filters articles below HN score threshold', () => {
		const articles = [makeArticle({ sourceScore: 5 })];
		expect(filterArticles(articles)).toHaveLength(0);
	});

	it('uses lower threshold for dev.to articles', () => {
		const articles = [makeArticle({ source: 'devto', sourceScore: 6 })];
		expect(filterArticles(articles)).toHaveLength(1);
	});

	it('filters dev.to articles below threshold', () => {
		const articles = [makeArticle({ source: 'devto', sourceScore: 3 })];
		expect(filterArticles(articles)).toHaveLength(0);
	});

	it('filters hiring/job posts', () => {
		const articles = [makeArticle({ titleEn: 'We are hiring senior engineers' })];
		expect(filterArticles(articles)).toHaveLength(0);
	});

	it('filters non-English TLD URLs', () => {
		const articles = [makeArticle({ originalUrl: 'https://example.cn/article' })];
		expect(filterArticles(articles)).toHaveLength(0);
	});

	it('keeps legitimate tech articles', () => {
		const articles = [
			makeArticle({
				titleEn: 'TypeScript 6.0 Released with Major Improvements',
				sourceScore: 200,
			}),
		];
		expect(filterArticles(articles)).toHaveLength(1);
	});

	it('handles empty array', () => {
		expect(filterArticles([])).toHaveLength(0);
	});
});
