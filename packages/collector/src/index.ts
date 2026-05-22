import type { CollectionResult, CollectorConfig, RawArticle } from '@techfeed/shared';
import { nowISO, toSQLiteDatetime } from '@techfeed/shared';
import { D1RestClient } from './d1-client.js';
import { dedup } from './dedup.js';
import { filterArticles } from './filter.js';
import { collectDevto } from './sources/devto.js';
import { collectHackerNews } from './sources/hackernews.js';

/**
 * Insert a single article into D1 via REST API.
 * Uses INSERT OR IGNORE to skip duplicates (original_url UNIQUE constraint).
 */
async function insertArticle(client: D1RestClient, article: RawArticle): Promise<boolean> {
	const sql = `
    INSERT OR IGNORE INTO articles (
      id, source, original_url, title_en, author,
      published_at, collected_at, source_score, tags, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `;

	const params = [
		article.id,
		article.source,
		article.originalUrl,
		article.titleEn,
		article.author ?? null,
		toSQLiteDatetime(article.publishedAt),
		toSQLiteDatetime(new Date().toISOString()),
		article.sourceScore,
		JSON.stringify(article.tags ?? []),
	];

	const result = await client.execute(sql, params);
	if (!result.success) {
		return false;
	}

	const meta = result.result[0]?.meta;
	return (meta?.rows_written ?? 0) > 0;
}

/**
 * Log a collection run to the collection_logs table.
 */
async function logCollectionRun(
	client: D1RestClient,
	runId: string,
	result: CollectionResult,
	startedAt: string,
): Promise<void> {
	const sql = `
    INSERT INTO collection_logs (
      run_id, source, started_at, finished_at,
      articles_found, articles_saved, articles_skipped,
      status, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

	const status = result.errors.length > 0 ? 'partial' : 'success';
	const errorMessage = result.errors.length > 0 ? result.errors.join('; ') : null;

	await client.execute(sql, [
		runId,
		result.source,
		startedAt,
		toSQLiteDatetime(new Date().toISOString()),
		result.articlesFound,
		result.articlesSaved,
		result.articlesSkipped,
		status,
		errorMessage,
	]);
}

type SourceInfo = { found: number; errors: string[] };

/**
 * Process a settled promise result for a source.
 */
function processSourceResult(
	settled: PromiseSettledResult<RawArticle[]>,
	sourceName: string,
	allRaw: RawArticle[],
): SourceInfo {
	if (settled.status === 'fulfilled') {
		allRaw.push(...settled.value);
		return { found: settled.value.length, errors: [] };
	}
	return { found: 0, errors: [`${sourceName} collection failed: ${settled.reason}`] };
}

/**
 * Save filtered articles to D1.
 */
async function saveArticles(
	client: D1RestClient,
	articles: RawArticle[],
	sourceResults: Map<string, SourceInfo>,
): Promise<void> {
	for (const article of articles) {
		const sourceInfo = sourceResults.get(article.source);
		try {
			await insertArticle(client, article);
		} catch (err) {
			sourceInfo?.errors.push(
				`Failed to insert ${article.id}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
}

/**
 * Build per-source collection results.
 */
function buildResults(
	sourceResults: Map<string, SourceInfo>,
	filtered: RawArticle[],
): CollectionResult[] {
	const results: CollectionResult[] = [];
	for (const [source, info] of sourceResults) {
		const sourceArticles = filtered.filter((a) => a.source === source);
		results.push({
			source: source as RawArticle['source'],
			articlesFound: info.found,
			articlesSaved: sourceArticles.length,
			articlesSkipped: info.found - sourceArticles.length,
			errors: info.errors,
		});
	}
	return results;
}

/**
 * Main collection entrypoint.
 *
 * Collects articles from all sources, deduplicates, filters,
 * and saves to D1 via Cloudflare REST API.
 */
export async function collect(config: CollectorConfig): Promise<CollectionResult[]> {
	const runId = `run_${Date.now()}`;

	const client = new D1RestClient(
		config.cloudflareAccountId,
		config.d1DatabaseId,
		config.cloudflareApiToken,
	);

	// Collect from all sources in parallel
	const [hnSettled, devtoSettled] = await Promise.allSettled([collectHackerNews(), collectDevto()]);

	const allRaw: RawArticle[] = [];
	const sourceResults = new Map<string, SourceInfo>();

	sourceResults.set('hackernews', processSourceResult(hnSettled, 'HN', allRaw));
	sourceResults.set('devto', processSourceResult(devtoSettled, 'dev.to', allRaw));

	// Deduplicate across sources, then filter by score and relevance
	const filtered = filterArticles(dedup(allRaw));

	// Save to D1 (skip in dry-run mode)
	if (!config.dryRun) {
		await saveArticles(client, filtered, sourceResults);
	}

	// Build per-source results
	const results = buildResults(sourceResults, filtered);

	// Log to D1 (skip in dry-run mode)
	if (!config.dryRun) {
		for (const result of results) {
			try {
				await logCollectionRun(client, runId, result, nowISO());
			} catch {
				// Logging failure should not break the pipeline
			}
		}
	}

	return results;
}

export { D1RestClient } from './d1-client.js';
export { dedup, normalizeUrl } from './dedup.js';
export { filterArticles } from './filter.js';
export { collectDevto } from './sources/devto.js';
export { collectHackerNews } from './sources/hackernews.js';

// --- CLI entry point ---
// Invoked directly by GitHub Actions: node dist/index.js
const argv = process.argv as string[];
if (argv[1]?.endsWith('index.js')) {
	const config = {
		cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
		cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN ?? '',
		d1DatabaseId: process.env.D1_DATABASE_ID ?? '',
		dryRun: process.env.DRY_RUN === 'true',
	};

	if (!config.cloudflareAccountId || !config.cloudflareApiToken || !config.d1DatabaseId) {
		console.error('[collector] Error: Missing required environment variables.');
		console.error('  CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID');
		process.exit(1);
	}

	collect(config)
		.then((results) => {
			for (const r of results) {
				console.log(
					`[collector] ${r.source}: found=${r.articlesFound} saved=${r.articlesSaved} skipped=${r.articlesSkipped} errors=${r.errors.length}`,
				);
			}
		})
		.catch((err) => {
			console.error('[collector] Fatal error:', err);
			process.exit(1);
		});
}
