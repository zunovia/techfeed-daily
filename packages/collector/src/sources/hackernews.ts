import type { RawArticle } from '@techfeed/shared';
import { unixToISO } from '@techfeed/shared';

const HN_API_BASE = 'https://hacker-news.firebaseio.com/v0';
const TOP_STORIES_LIMIT = 50;

/** HN API item shape (subset of fields we use) */
interface HNItem {
	id: number;
	type: string;
	title?: string;
	url?: string;
	by?: string;
	time?: number;
	score?: number;
	descendants?: number;
}

/**
 * Fetch a single HN item by ID.
 */
async function fetchItem(id: number): Promise<HNItem | null> {
	const response = await fetch(`${HN_API_BASE}/item/${id}.json`);
	if (!response.ok) return null;
	return (await response.json()) as HNItem;
}

/**
 * Fetch top story IDs from Hacker News.
 */
async function fetchTopStoryIds(): Promise<number[]> {
	const response = await fetch(`${HN_API_BASE}/topstories.json`);
	if (!response.ok) {
		throw new Error(`Failed to fetch HN top stories: ${response.status}`);
	}
	const ids = (await response.json()) as number[];
	return ids.slice(0, TOP_STORIES_LIMIT);
}

/**
 * Collect top articles from Hacker News.
 *
 * Fetches the top 50 story IDs, then fetches each item in parallel
 * (with concurrency limit). Filters out items without URLs (e.g., Ask HN).
 */
export async function collectHackerNews(): Promise<RawArticle[]> {
	const storyIds = await fetchTopStoryIds();

	// Fetch items in parallel with concurrency limit of 10
	const articles: RawArticle[] = [];
	const concurrency = 10;

	for (let i = 0; i < storyIds.length; i += concurrency) {
		const batch = storyIds.slice(i, i + concurrency);
		const items = await Promise.all(batch.map((id) => fetchItem(id)));

		for (const item of items) {
			if (!item?.url || !item.title || item.type !== 'story') {
				continue;
			}

			articles.push({
				id: `hn_${item.id}`,
				source: 'hackernews',
				originalUrl: item.url,
				titleEn: item.title,
				author: item.by,
				publishedAt: item.time ? unixToISO(item.time) : new Date().toISOString(),
				sourceScore: item.score ?? 0,
				tags: [],
			});
		}
	}

	return articles;
}
