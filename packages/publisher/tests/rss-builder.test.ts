import { describe, expect, it } from 'vitest';
import type { Article } from '../../../packages/shared/src/types/index.js';
import { buildRssXml } from '../src/rss-builder.js';

function makeArticle(overrides: Partial<Article> = {}): Article {
	return {
		id: 'test-article-001',
		source: 'hackernews',
		originalUrl: 'https://example.com/article',
		titleEn: 'Test Article',
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

const BASE_OPTIONS = {
	baseUrl: 'https://techfeed-daily.example.workers.dev',
	date: '2026-05-22',
};

describe('buildRssXml', () => {
	it('should produce valid RSS 2.0 envelope', () => {
		const xml = buildRssXml([makeArticle()], BASE_OPTIONS);

		expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(xml).toContain('<rss version="2.0"');
		expect(xml).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');
		expect(xml).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
		expect(xml).toContain('xmlns:techfeed="https://techfeed-daily.dev/ns/1.0"');
		expect(xml).toContain('<channel>');
		expect(xml).toContain('</channel>');
		expect(xml).toContain('</rss>');
	});

	it('should include channel metadata', () => {
		const xml = buildRssXml([makeArticle()], BASE_OPTIONS);

		expect(xml).toContain('TechFeed Daily — 2026-05-22');
		expect(xml).toContain('https://techfeed-daily.example.workers.dev/api/articles/2026-05-22');
		expect(xml).toContain('atom:link');
		expect(xml).toContain('rel="self"');
	});

	it('should include item with correct fields', () => {
		const xml = buildRssXml([makeArticle()], BASE_OPTIONS);

		expect(xml).toContain('<item>');
		expect(xml).toContain('</item>');
		expect(xml).toContain('<![CDATA[テスト記事]]>');
		expect(xml).toContain('https://example.com/article');
		expect(xml).toContain('test-article-001');
		expect(xml).toContain('<![CDATA[Test Author]]>');
		expect(xml).toContain('<![CDATA[これはテスト要約です。]]>');
		expect(xml).toContain('<techfeed:importanceScore>85</techfeed:importanceScore>');
	});

	it('should include tags as category elements', () => {
		const xml = buildRssXml([makeArticle()], BASE_OPTIONS);

		expect(xml).toContain('<category>typescript</category>');
		expect(xml).toContain('<category>performance</category>');
	});

	it('should fall back to titleEn when titleJa is absent', () => {
		const article = makeArticle({ titleJa: undefined });
		const xml = buildRssXml([article], BASE_OPTIONS);

		expect(xml).toContain('<![CDATA[Test Article]]>');
	});

	it('should handle multiple articles', () => {
		const articles = [
			makeArticle({ id: 'art-001', titleJa: '記事1', importanceScore: 90 }),
			makeArticle({ id: 'art-002', titleJa: '記事2', importanceScore: 80 }),
			makeArticle({ id: 'art-003', titleJa: '記事3', importanceScore: 70 }),
		];
		const xml = buildRssXml(articles, BASE_OPTIONS);

		expect(xml.match(/<item>/g)?.length).toBe(3);
		expect(xml).toContain('art-001');
		expect(xml).toContain('art-002');
		expect(xml).toContain('art-003');
	});

	it('should escape XML special characters in URLs', () => {
		const article = makeArticle({
			originalUrl: 'https://example.com/article?a=1&b=2',
		});
		const xml = buildRssXml([article], BASE_OPTIONS);

		expect(xml).toContain('https://example.com/article?a=1&amp;b=2');
	});

	it('should escape CDATA end sequence in content', () => {
		const article = makeArticle({
			summaryJa: 'Bad content ]]> end',
		});
		const xml = buildRssXml([article], BASE_OPTIONS);

		// Original ]]> must not appear verbatim inside CDATA
		// It should be split: ]]>]]><![CDATA[
		expect(xml).not.toContain('Bad content ]]> end');
		expect(xml).toContain('Bad content ]]>]]><![CDATA[ end');
	});

	it('should return empty channel with no items for empty array', () => {
		const xml = buildRssXml([], BASE_OPTIONS);

		expect(xml).toContain('<channel>');
		expect(xml).not.toContain('<item>');
	});
});
