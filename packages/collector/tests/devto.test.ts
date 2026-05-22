import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectDevto } from '../src/sources/devto.js';

describe('collectDevto', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('fetches articles and converts to RawArticle format', async () => {
		const mockFetch = vi.mocked(globalThis.fetch);

		mockFetch.mockResolvedValue(
			new Response(
				JSON.stringify([
					{
						id: 123,
						title: 'Building with TypeScript',
						url: 'https://dev.to/user/building-with-ts',
						canonical_url: 'https://blog.example.com/building-with-ts',
						user: { username: 'devuser' },
						published_at: '2026-05-22T10:00:00Z',
						positive_reactions_count: 42,
						public_reactions_count: 50,
						tag_list: ['typescript', 'webdev'],
					},
				]),
			),
		);

		const articles = await collectDevto();

		expect(articles).toHaveLength(1);
		expect(articles[0].id).toBe('devto_123');
		expect(articles[0].source).toBe('devto');
		// Should prefer canonical_url
		expect(articles[0].originalUrl).toBe('https://blog.example.com/building-with-ts');
		expect(articles[0].titleEn).toBe('Building with TypeScript');
		expect(articles[0].author).toBe('devuser');
		expect(articles[0].sourceScore).toBe(50);
		expect(articles[0].tags).toEqual(['typescript', 'webdev']);
	});

	it('throws on API failure', async () => {
		const mockFetch = vi.mocked(globalThis.fetch);
		mockFetch.mockResolvedValue(new Response('Error', { status: 500 }));

		await expect(collectDevto()).rejects.toThrow('Failed to fetch dev.to articles');
	});
});
