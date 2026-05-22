import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectHackerNews } from '../src/sources/hackernews.js';

describe('collectHackerNews', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('fetches top stories and converts to RawArticle format', async () => {
		const mockFetch = vi.mocked(globalThis.fetch);

		// Mock top stories endpoint
		mockFetch.mockImplementation(async (url: string | URL | Request) => {
			const urlStr = typeof url === 'string' ? url : url.toString();

			if (urlStr.includes('topstories.json')) {
				return new Response(JSON.stringify([1, 2, 3]));
			}
			if (urlStr.includes('/item/1.json')) {
				return new Response(
					JSON.stringify({
						id: 1,
						type: 'story',
						title: 'Test Article 1',
						url: 'https://example.com/article-1',
						by: 'testuser',
						time: 1716336000,
						score: 150,
					}),
				);
			}
			if (urlStr.includes('/item/2.json')) {
				return new Response(
					JSON.stringify({
						id: 2,
						type: 'story',
						title: 'Test Article 2',
						url: 'https://example.com/article-2',
						by: 'testuser2',
						time: 1716336000,
						score: 75,
					}),
				);
			}
			if (urlStr.includes('/item/3.json')) {
				// Ask HN (no URL) - should be filtered
				return new Response(
					JSON.stringify({
						id: 3,
						type: 'story',
						title: 'Ask HN: Question?',
						by: 'testuser3',
						time: 1716336000,
						score: 200,
					}),
				);
			}
			return new Response('Not found', { status: 404 });
		});

		const articles = await collectHackerNews();

		expect(articles).toHaveLength(2);
		expect(articles[0].id).toBe('hn_1');
		expect(articles[0].source).toBe('hackernews');
		expect(articles[0].originalUrl).toBe('https://example.com/article-1');
		expect(articles[0].titleEn).toBe('Test Article 1');
		expect(articles[0].author).toBe('testuser');
		expect(articles[0].sourceScore).toBe(150);
	});

	it('throws on API failure', async () => {
		const mockFetch = vi.mocked(globalThis.fetch);
		mockFetch.mockResolvedValue(new Response('Server Error', { status: 500 }));

		await expect(collectHackerNews()).rejects.toThrow('Failed to fetch HN top stories');
	});
});
