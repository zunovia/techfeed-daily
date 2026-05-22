import type { RawArticle } from '@techfeed/shared';

const DEVTO_API_BASE = 'https://dev.to/api/articles';
const ARTICLES_PER_PAGE = 30;

/** dev.to API article shape (subset of fields we use) */
interface DevtoArticle {
	id: number;
	title: string;
	url: string;
	canonical_url?: string;
	user: {
		username: string;
	};
	published_at: string;
	positive_reactions_count: number;
	public_reactions_count: number;
	tag_list: string[];
}

/**
 * Collect top articles from dev.to.
 *
 * Uses the public API to fetch top articles from the past day.
 * No authentication required.
 *
 * @see https://developers.forem.com/api/v1
 */
export async function collectDevto(): Promise<RawArticle[]> {
	const response = await fetch(`${DEVTO_API_BASE}?top=1&per_page=${ARTICLES_PER_PAGE}`, {
		headers: {
			Accept: 'application/json',
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch dev.to articles: ${response.status}`);
	}

	const items = (await response.json()) as DevtoArticle[];

	return items.map((item) => ({
		id: `devto_${item.id}`,
		source: 'devto' as const,
		originalUrl: item.canonical_url || item.url,
		titleEn: item.title,
		author: item.user.username,
		publishedAt: item.published_at,
		sourceScore: item.public_reactions_count || item.positive_reactions_count,
		tags: item.tag_list ?? [],
	}));
}
