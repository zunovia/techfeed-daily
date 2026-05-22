import type { RawArticle } from '@techfeed/shared';

/** Minimum source score to keep an article */
const MIN_SCORE_HN = 10;
const MIN_SCORE_DEVTO = 5;

/**
 * Patterns in URLs/titles that indicate non-English content or
 * non-tech content we want to skip.
 */
const SKIP_URL_PATTERNS = [
	/\.(cn|ru|kr|jp|br|de|fr|es|it|pt|pl|nl|tr)\//i, // Non-English TLDs
];

const SKIP_TITLE_PATTERNS = [
	/hiring|job|career|recruit/i,
	/show hn:\s*my\s/i, // Very personal Show HN
];

/**
 * Filter articles based on score threshold and content relevance.
 *
 * Applies:
 * - Source-specific minimum score thresholds
 * - URL-based language filtering
 * - Title-based content filtering
 */
export function filterArticles(articles: RawArticle[]): RawArticle[] {
	return articles.filter((article) => {
		// Score threshold per source
		const minScore = article.source === 'hackernews' ? MIN_SCORE_HN : MIN_SCORE_DEVTO;
		if (article.sourceScore < minScore) {
			return false;
		}

		// URL-based filtering
		for (const pattern of SKIP_URL_PATTERNS) {
			if (pattern.test(article.originalUrl)) {
				return false;
			}
		}

		// Title-based filtering
		for (const pattern of SKIP_TITLE_PATTERNS) {
			if (pattern.test(article.titleEn)) {
				return false;
			}
		}

		return true;
	});
}
