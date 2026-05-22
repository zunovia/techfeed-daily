import type { Article } from '@techfeed/shared';
import { buildRssXml } from '@techfeed/shared';
import { Hono } from 'hono';
import type { WorkerEnv } from '../types.js';

const rss = new Hono<{ Bindings: WorkerEnv }>();

/** Row shape returned by the D1 articles query */
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

async function fetchRssFromD1(db: D1Database, date: string, baseUrl: string): Promise<string> {
	const { results } = await db
		.prepare(
			`SELECT * FROM articles
       WHERE status = 'published'
         AND date(published_at) = ?
       ORDER BY importance_score DESC
       LIMIT 30`,
		)
		.bind(date)
		.all<ArticleRow>();

	const articles = (results ?? []).map(rowToArticle);
	return buildRssXml(articles, { baseUrl, date });
}

/**
 * GET /rss
 * Returns the latest day's RSS feed.
 */
rss.get('/', async (c) => {
	// Resolve latest date from KV
	let date = await c.env.KV.get('rss:daily:latest');

	if (!date) {
		// Fallback: use today
		date = new Date().toISOString().slice(0, 10);
	}

	// Try KV cache first
	const cached = await c.env.KV.get(`rss:daily:${date}`);
	if (cached) {
		return c.body(cached, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
	}

	// D1 fallback — build dynamically
	const baseUrl = new URL(c.req.url).origin;
	try {
		const xml = await fetchRssFromD1(c.env.DB, date, baseUrl);
		return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
	} catch (err) {
		console.error('[rss] D1 fallback failed:', err);
		return c.json({ error: 'Feed temporarily unavailable' }, 503);
	}
});

/**
 * GET /rss/:date
 * Returns the RSS feed for a specific date (YYYY-MM-DD).
 */
rss.get('/:date', async (c) => {
	const date = c.req.param('date');

	// Basic date format validation
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		return c.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, 400);
	}

	// Try KV cache first
	const cached = await c.env.KV.get(`rss:daily:${date}`);
	if (cached) {
		return c.body(cached, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
	}

	// D1 fallback
	const baseUrl = new URL(c.req.url).origin;
	try {
		const xml = await fetchRssFromD1(c.env.DB, date, baseUrl);
		return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
	} catch (err) {
		console.error(`[rss] D1 fallback failed for date=${date}:`, err);
		return c.json({ error: 'Feed temporarily unavailable' }, 503);
	}
});

export { rss };
