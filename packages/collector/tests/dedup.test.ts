import type { RawArticle } from '@techfeed/shared';
import { describe, expect, it } from 'vitest';
import { dedup, normalizeUrl } from '../src/dedup.js';

describe('normalizeUrl', () => {
	it('removes trailing slash', () => {
		expect(normalizeUrl('https://example.com/article/')).toBe('https://example.com/article');
	});

	it('keeps root slash', () => {
		expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
	});

	it('removes www prefix', () => {
		expect(normalizeUrl('https://www.example.com/page')).toBe('https://example.com/page');
	});

	it('normalizes http to https', () => {
		expect(normalizeUrl('http://example.com/page')).toBe('https://example.com/page');
	});

	it('removes UTM parameters', () => {
		expect(normalizeUrl('https://example.com/page?utm_source=twitter&utm_medium=social')).toBe(
			'https://example.com/page',
		);
	});

	it('keeps non-tracking query parameters', () => {
		const url = 'https://example.com/search?q=typescript';
		expect(normalizeUrl(url)).toBe(url);
	});

	it('removes fragment identifiers', () => {
		expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
	});

	it('handles invalid URLs gracefully', () => {
		expect(normalizeUrl('not-a-url')).toBe('not-a-url');
	});
});

describe('dedup', () => {
	const makeArticle = (id: string, url: string, score: number): RawArticle => ({
		id,
		source: 'hackernews',
		originalUrl: url,
		titleEn: `Article ${id}`,
		publishedAt: '2026-05-22T00:00:00Z',
		sourceScore: score,
	});

	it('removes duplicate URLs', () => {
		const articles = [
			makeArticle('1', 'https://example.com/post', 100),
			makeArticle('2', 'https://example.com/post', 50),
		];
		const result = dedup(articles);
		expect(result).toHaveLength(1);
	});

	it('keeps article with higher score on duplicate', () => {
		const articles = [
			makeArticle('1', 'https://example.com/post', 50),
			makeArticle('2', 'https://example.com/post', 100),
		];
		const result = dedup(articles);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('2');
	});

	it('treats www and non-www as same URL', () => {
		const articles = [
			makeArticle('1', 'https://www.example.com/post', 100),
			makeArticle('2', 'https://example.com/post', 50),
		];
		const result = dedup(articles);
		expect(result).toHaveLength(1);
	});

	it('treats http and https as same URL', () => {
		const articles = [
			makeArticle('1', 'http://example.com/post', 100),
			makeArticle('2', 'https://example.com/post', 50),
		];
		const result = dedup(articles);
		expect(result).toHaveLength(1);
	});

	it('keeps unique articles', () => {
		const articles = [
			makeArticle('1', 'https://example.com/post-1', 100),
			makeArticle('2', 'https://example.com/post-2', 50),
		];
		const result = dedup(articles);
		expect(result).toHaveLength(2);
	});
});
