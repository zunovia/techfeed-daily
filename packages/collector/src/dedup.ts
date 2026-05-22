import type { RawArticle } from '@techfeed/shared';

/**
 * Normalize a URL for deduplication.
 *
 * Removes:
 * - Trailing slashes
 * - Query parameters (utm_*, ref, etc.)
 * - Fragment identifiers
 * - www. prefix
 * - Protocol differences (treat http/https as same)
 */
export function normalizeUrl(url: string): string {
	try {
		const parsed = new URL(url);

		// Normalize protocol to https
		parsed.protocol = 'https:';

		// Remove www. prefix
		parsed.hostname = parsed.hostname.replace(/^www\./, '');

		// Remove tracking query parameters
		const trackingParams = [
			'utm_source',
			'utm_medium',
			'utm_campaign',
			'utm_term',
			'utm_content',
			'ref',
			'source',
			'fbclid',
			'gclid',
		];
		for (const param of trackingParams) {
			parsed.searchParams.delete(param);
		}

		// If no remaining params, clear search string
		if (parsed.searchParams.toString() === '') {
			parsed.search = '';
		}

		// Remove fragment
		parsed.hash = '';

		// Remove trailing slash (but keep root /)
		let normalized = parsed.toString();
		if (normalized.endsWith('/') && parsed.pathname !== '/') {
			normalized = normalized.slice(0, -1);
		}

		return normalized;
	} catch {
		// If URL parsing fails, return as-is lowercase
		return url.toLowerCase().trim();
	}
}

/**
 * Deduplicate articles by normalized URL.
 *
 * When duplicates are found, keeps the one with the higher sourceScore.
 */
export function dedup(articles: RawArticle[]): RawArticle[] {
	const seen = new Map<string, RawArticle>();

	for (const article of articles) {
		const normalizedUrl = normalizeUrl(article.originalUrl);
		const existing = seen.get(normalizedUrl);

		if (!existing || article.sourceScore > existing.sourceScore) {
			seen.set(normalizedUrl, article);
		}
	}

	return Array.from(seen.values());
}
