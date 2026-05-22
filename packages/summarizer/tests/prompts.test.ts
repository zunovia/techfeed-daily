import type { RawArticle } from '@techfeed/shared';
import { describe, expect, it } from 'vitest';
import { buildUserPrompt, SYSTEM_PROMPT, SYSTEM_PROMPT_BLOCK } from '../src/prompts.js';

/**
 * Build a minimal valid RawArticle for testing.
 */
function makeArticle(overrides: Partial<RawArticle> = {}): RawArticle {
	return {
		id: 'hn_12345',
		source: 'hackernews',
		originalUrl: 'https://example.com/article',
		titleEn: 'TypeScript 5.5 Released with Improved Performance',
		author: 'testuser',
		publishedAt: '2026-05-22T06:00:00Z',
		sourceScore: 250,
		tags: ['typescript', 'javascript'],
		...overrides,
	};
}

describe('SYSTEM_PROMPT', () => {
	it('contains required instructions for JSON output', () => {
		expect(SYSTEM_PROMPT).toContain('JSON形式');
		expect(SYSTEM_PROMPT).toContain('titleJa');
		expect(SYSTEM_PROMPT).toContain('summaryJa');
		expect(SYSTEM_PROMPT).toContain('importanceScore');
		expect(SYSTEM_PROMPT).toContain('scoreReason');
		expect(SYSTEM_PROMPT).toContain('tags');
	});

	it('contains importance score criteria', () => {
		expect(SYSTEM_PROMPT).toContain('90-100');
		expect(SYSTEM_PROMPT).toContain('70-89');
		expect(SYSTEM_PROMPT).toContain('50-69');
		expect(SYSTEM_PROMPT).toContain('30-49');
		expect(SYSTEM_PROMPT).toContain('1-29');
	});

	it('is a non-empty string', () => {
		expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
	});
});

describe('SYSTEM_PROMPT_BLOCK', () => {
	it('has correct type', () => {
		expect(SYSTEM_PROMPT_BLOCK.type).toBe('text');
	});

	it('has cache_control set to ephemeral', () => {
		expect(SYSTEM_PROMPT_BLOCK.cache_control).toEqual({ type: 'ephemeral' });
	});

	it('text equals SYSTEM_PROMPT', () => {
		expect(SYSTEM_PROMPT_BLOCK.text).toBe(SYSTEM_PROMPT);
	});
});

describe('buildUserPrompt', () => {
	it('includes article title', () => {
		const article = makeArticle();
		const prompt = buildUserPrompt(article);
		expect(prompt).toContain(article.titleEn);
	});

	it('includes article URL', () => {
		const article = makeArticle();
		const prompt = buildUserPrompt(article);
		expect(prompt).toContain(article.originalUrl);
	});

	it('includes source name', () => {
		const article = makeArticle();
		const prompt = buildUserPrompt(article);
		expect(prompt).toContain('hackernews');
	});

	it('includes source score', () => {
		const article = makeArticle({ sourceScore: 999 });
		const prompt = buildUserPrompt(article);
		expect(prompt).toContain('999');
	});

	it('includes author when provided', () => {
		const article = makeArticle({ author: 'johndoe' });
		const prompt = buildUserPrompt(article);
		expect(prompt).toContain('johndoe');
	});

	it('omits author line when author is undefined', () => {
		const article = makeArticle({ author: undefined });
		const prompt = buildUserPrompt(article);
		expect(prompt).not.toContain('著者:');
	});

	it('includes tags when provided', () => {
		const article = makeArticle({ tags: ['react', 'hooks'] });
		const prompt = buildUserPrompt(article);
		expect(prompt).toContain('react');
		expect(prompt).toContain('hooks');
	});

	it('omits tags line when tags is undefined', () => {
		const article = makeArticle({ tags: undefined });
		const prompt = buildUserPrompt(article);
		expect(prompt).not.toContain('タグ:');
	});

	it('omits tags line when tags is empty array', () => {
		const article = makeArticle({ tags: [] });
		const prompt = buildUserPrompt(article);
		expect(prompt).not.toContain('タグ:');
	});

	it('includes published date', () => {
		const article = makeArticle({ publishedAt: '2026-05-22T06:00:00Z' });
		const prompt = buildUserPrompt(article);
		expect(prompt).toContain('2026-05-22T06:00:00Z');
	});

	it('includes instruction to output in JSON format', () => {
		const article = makeArticle();
		const prompt = buildUserPrompt(article);
		expect(prompt).toContain('JSON形式');
	});

	it('returns a non-empty string', () => {
		const article = makeArticle();
		const prompt = buildUserPrompt(article);
		expect(typeof prompt).toBe('string');
		expect(prompt.length).toBeGreaterThan(50);
	});

	it('handles devto source', () => {
		const article = makeArticle({ source: 'devto' });
		const prompt = buildUserPrompt(article);
		expect(prompt).toContain('devto');
	});
});
