import { D1RestClient } from '@techfeed/collector';
import type { Article } from '@techfeed/shared';
import { buildJsonResponse, buildRssXml } from '@techfeed/shared';
import { KvRestClient } from './kv-client.js';

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

/** Map a raw D1 row to the shared Article type */
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

export interface PublisherConfig {
	cloudflareAccountId: string;
	cloudflareApiToken: string;
	d1DatabaseId: string;
	kvNamespaceId: string;
	/** Base URL for feed links, e.g. https://techfeed-daily.example.workers.dev */
	baseUrl: string;
	/** Target date (YYYY-MM-DD). Defaults to today (UTC). */
	date?: string;
	dryRun?: boolean;
}

function todayUtc(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Main publisher entry point.
 *
 * 1. Fetch published articles from D1 (TOP 30 by importance_score).
 * 2. Build RSS XML and write to KV.
 * 3. Build JSON response and write to KV.
 * 4. Update meta:last_updated in KV.
 */
export async function publish(config: PublisherConfig): Promise<void> {
	const date = config.date ?? todayUtc();

	console.log(`[publisher] Starting publish for date=${date} dryRun=${config.dryRun ?? false}`);

	// --- Fetch articles from D1 ---
	const d1 = new D1RestClient(
		config.cloudflareAccountId,
		config.d1DatabaseId,
		config.cloudflareApiToken,
	);

	// Use collected_at (not published_at) as the date filter.
	// published_at is the SOURCE article's publication date (often 1-3 days old for
	// HN top stories), while collected_at is always the UTC timestamp of collection.
	// Matching by collected_at within the last 24 hours ensures we publish articles
	// that were actually collected during today's pipeline run.
	const queryResult = await d1.execute<ArticleRow>(
		`SELECT * FROM articles
     WHERE status = 'published'
       AND collected_at >= datetime('now', '-24 hours')
     ORDER BY importance_score DESC
     LIMIT 30`,
		[],
	);

	if (!queryResult.success || queryResult.result.length === 0) {
		console.error('[publisher] D1 query failed or returned no results', queryResult.errors);
		throw new Error('D1 query failed');
	}

	const rows = queryResult.result[0]?.results ?? [];
	const articles: Article[] = rows.map(rowToArticle);

	console.log(`[publisher] Fetched ${articles.length} published articles (collected in last 24h)`);

	if (articles.length === 0) {
		console.warn('[publisher] No published articles found — aborting');
		return;
	}

	// --- Build payloads ---
	const rssXml = buildRssXml(articles, { baseUrl: config.baseUrl, date });
	const jsonResponse = buildJsonResponse(articles, { date });
	const jsonString = JSON.stringify(jsonResponse);
	const nowIso = new Date().toISOString();

	if (config.dryRun) {
		console.log('[publisher] DRY RUN — skipping KV writes');
		console.log(`[publisher] RSS size: ${rssXml.length} bytes`);
		console.log(`[publisher] JSON size: ${jsonString.length} bytes`);
		return;
	}

	// --- Write to KV ---
	const kv = new KvRestClient(
		config.cloudflareAccountId,
		config.kvNamespaceId,
		config.cloudflareApiToken,
	);

	// RSS: dated + latest pointer
	await kv.put(`rss:daily:${date}`, rssXml, 90000);
	console.log(`[publisher] KV written: rss:daily:${date}`);

	await kv.put('rss:daily:latest', date, 3600);
	console.log('[publisher] KV written: rss:daily:latest');

	// JSON: dated + latest pointer
	await kv.put(`api:articles:${date}`, jsonString, 90000);
	console.log(`[publisher] KV written: api:articles:${date}`);

	await kv.put('api:articles:latest', jsonString, 3600);
	console.log('[publisher] KV written: api:articles:latest');

	// Individual articles
	for (const article of articles) {
		const singleJson = JSON.stringify(article);
		await kv.put(`api:article:${article.id}`, singleJson, 604800);
	}
	console.log(`[publisher] KV written: ${articles.length} individual article entries`);

	// Meta
	await kv.put('meta:last_updated', nowIso, 3600);
	console.log('[publisher] KV written: meta:last_updated');

	console.log(`[publisher] Publish complete for date=${date}`);
}

// --- CLI entry point ---
// Invoked directly by GitHub Actions: node dist/index.js
const argv = process.argv as string[];
if (argv[1]?.endsWith('index.js')) {
	const config: PublisherConfig = {
		cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
		cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN ?? '',
		d1DatabaseId: process.env.D1_DATABASE_ID ?? '',
		kvNamespaceId: process.env.KV_NAMESPACE_ID ?? '',
		baseUrl: process.env.WORKER_BASE_URL ?? 'https://techfeed-daily.example.workers.dev',
		date: process.env.PUBLISH_DATE,
		dryRun: process.env.DRY_RUN === 'true',
	};

	publish(config).catch((err) => {
		console.error('[publisher] Fatal error:', err);
		process.exit(1);
	});
}
