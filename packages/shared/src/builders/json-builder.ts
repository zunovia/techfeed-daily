import type { ApiResponse, Article, ArticleResponse } from '../types/index.js';

/**
 * Convert a raw DB Article into the public ArticleResponse shape.
 */
function toArticleResponse(article: Article): ArticleResponse {
	return {
		id: article.id,
		source: article.source,
		originalUrl: article.originalUrl,
		titleJa: article.titleJa ?? article.titleEn,
		summaryJa: article.summaryJa ?? '',
		importanceScore: article.importanceScore,
		tags: article.tags,
		author: article.author,
		publishedAt: article.publishedAt,
	};
}

/**
 * Calculate the next update time.
 * The pipeline runs at 06:00 JST (21:00 UTC previous day),
 * so we approximate as "today 21:00 UTC" or "tomorrow 21:00 UTC"
 * depending on the current time.
 */
function calcNextUpdate(): string {
	const now = new Date();
	const next = new Date(now);
	next.setUTCHours(21, 0, 0, 0);
	if (now.getUTCHours() >= 21) {
		next.setUTCDate(next.getUTCDate() + 1);
	}
	return next.toISOString();
}

export interface JsonBuildOptions {
	/** Date for which this response was generated (YYYY-MM-DD) */
	date: string;
}

/**
 * Build the ApiResponse<ArticleResponse[]> JSON payload.
 *
 * Articles should already be sorted by importance_score descending and
 * limited to TOP 30 by the caller.
 */
export function buildJsonResponse(
	articles: Article[],
	options: JsonBuildOptions,
): ApiResponse<ArticleResponse[]> {
	const { date } = options;

	return {
		data: articles.map(toArticleResponse),
		meta: {
			date,
			totalCount: articles.length,
			generatedAt: new Date().toISOString(),
			nextUpdate: calcNextUpdate(),
		},
	};
}
