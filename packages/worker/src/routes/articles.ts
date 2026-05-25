import type { ApiResponse, Article, ArticleResponse } from '@techfeed/shared';
import { buildJsonResponse } from '@techfeed/shared';
import { Hono } from 'hono';
import type { WorkerEnv } from '../types.js';

const articles = new Hono<{ Bindings: WorkerEnv }>();

/** Row shape returned by D1 */
interface ArticleRow {
	id: string;
	source: string;
	original_url: string;
	title_en: string;
	title_ja: string | null;
	summary_ja: string | null;
	importance_score: number;
	score_reason: string | null;
	tags: string | null;
	author: string | null;
	published_at: string;
	collected_at: string;
	status: string;
	retry_count: number;
	error_message: string | null;
	source_score: number;
	created_at: string;
	updated_at: string;
}

function rowToArticle(row: ArticleRow): Article {
	return {
		id: row.id,
		source: row.source as Article['source'],
		originalUrl: row.original_url,
		titleEn: row.title_en,
		titleJa: row.title_ja ?? undefined,
		summaryJa: row.summary_ja ?? undefined,
		importanceScore: row.importance_score,
		scoreReason: row.score_reason ?? undefined,
		tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
		author: row.author ?? undefined,
		publishedAt: row.published_at,
		collectedAt: row.collected_at,
		status: row.status as Article['status'],
		retryCount: row.retry_count,
		errorMessage: row.error_message ?? undefined,
		sourceScore: row.source_score,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function fetchArticlesFromD1(
	db: D1Database,
	date: string,
): Promise<ApiResponse<ArticleResponse[]>> {
	// Use collected_at (not published_at) as the date filter.
	// published_at is the SOURCE article's publication date (often 1-3 days old for
	// HN top stories), while collected_at is always the UTC timestamp of collection.
	// Matching by collected_at within the last 24 hours ensures we return articles
	// that were actually collected during today's pipeline run.
	const { results } = await db
		.prepare(
			`SELECT * FROM articles
       WHERE status = 'published'
         AND collected_at >= datetime('now', '-24 hours')
       ORDER BY importance_score DESC
       LIMIT 30`,
		)
		.all<ArticleRow>();

	const articleList = (results ?? []).map(rowToArticle);
	return buildJsonResponse(articleList, { date });
}

/**
 * GET /api/articles
 * Returns today's TOP 30 articles (KV cache → D1 fallback).
 */
articles.get('/', async (c) => {
	// Try latest from KV
	const cached = await c.env.KV.get('api:articles:latest');
	if (cached) {
		return c.json(JSON.parse(cached) as ApiResponse<ArticleResponse[]>);
	}

	// D1 fallback
	const date = new Date().toISOString().slice(0, 10);
	try {
		const response = await fetchArticlesFromD1(c.env.DB, date);
		return c.json(response);
	} catch (err) {
		console.error('[articles] D1 fallback failed:', err);
		return c.json({ error: 'Articles temporarily unavailable' }, 503);
	}
});

/**
 * GET /api/articles/:date
 * Returns articles for a specific date (YYYY-MM-DD).
 */
articles.get('/:date', async (c) => {
	const date = c.req.param('date');

	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		return c.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, 400);
	}

	// Try KV cache
	const cached = await c.env.KV.get(`api:articles:${date}`);
	if (cached) {
		return c.json(JSON.parse(cached) as ApiResponse<ArticleResponse[]>);
	}

	// D1 fallback
	try {
		const response = await fetchArticlesFromD1(c.env.DB, date);
		return c.json(response);
	} catch (err) {
		console.error(`[articles] D1 fallback failed for date=${date}:`, err);
		return c.json({ error: 'Articles temporarily unavailable' }, 503);
	}
});

/**
 * GET /api/articles/item/:id
 * Returns a single article by ID.
 */
articles.get('/item/:id', async (c) => {
	const id = c.req.param('id');

	// Try KV cache
	const cached = await c.env.KV.get(`api:article:${id}`);
	if (cached) {
		return c.json({ data: JSON.parse(cached) as Article });
	}

	// D1 fallback
	try {
		const row = await c.env.DB.prepare('SELECT * FROM articles WHERE id = ?')
			.bind(id)
			.first<ArticleRow>();

		if (!row) {
			return c.json({ error: 'Article not found' }, 404);
		}

		const article = rowToArticle(row);
		return c.json({ data: article });
	} catch (err) {
		console.error(`[articles] D1 fallback failed for id=${id}:`, err);
		return c.json({ error: 'Article temporarily unavailable' }, 503);
	}
});

export { articles };
