import type { RawArticle } from '@techfeed/shared';
import { chunk } from '@techfeed/shared';
import { type SummarizeResult, summarizeBatch } from './batch.js';
import { D1RestClient } from './d1-client.js';
import { checkSummaryQuality } from './quality-check.js';

/** Batch size for Claude API calls */
const BATCH_SIZE = 20;

/**
 * Configuration for the summarizer.
 */
export interface SummarizerConfig {
	cloudflareAccountId: string;
	cloudflareApiToken: string;
	d1DatabaseId: string;
	claudeApiKey: string;
	dryRun?: boolean;
}

/**
 * Result row from D1 articles table query.
 */
interface ArticleRow {
	id: string;
	source: string;
	original_url: string;
	title_en: string;
	author: string | null;
	published_at: string;
	source_score: number;
	tags: string | null;
	retry_count: number;
}

/**
 * Summary run result.
 */
export interface SummaryRunResult {
	total: number;
	published: number;
	failed: number;
	skipped: number;
}

/** Mutable counters passed between helpers */
interface RunCounters {
	published: number;
	failed: number;
}

/**
 * Fetch articles with status='pending' from D1.
 */
async function fetchPendingArticles(client: D1RestClient): Promise<RawArticle[]> {
	const sql = `
    SELECT id, source, original_url, title_en, author,
           published_at, source_score, tags, retry_count
    FROM articles
    WHERE status = 'pending'
    ORDER BY source_score DESC, published_at DESC
    LIMIT 100
  `;

	const response = await client.execute<ArticleRow>(sql);
	if (!response.success || response.result.length === 0) {
		return [];
	}

	return response.result[0].results.map(
		(row): RawArticle => ({
			id: row.id,
			source: row.source as RawArticle['source'],
			originalUrl: row.original_url,
			titleEn: row.title_en,
			author: row.author ?? undefined,
			publishedAt: row.published_at,
			sourceScore: row.source_score,
			tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
		}),
	);
}

/**
 * Mark an article as 'summarizing' before processing.
 */
async function markSummarizing(client: D1RestClient, articleId: string): Promise<void> {
	await client.execute(
		`UPDATE articles SET status = 'summarizing', updated_at = datetime('now') WHERE id = ?`,
		[articleId],
	);
}

/**
 * Write summary results to D1 and mark article as 'published'.
 */
async function publishArticle(
	client: D1RestClient,
	articleId: string,
	titleJa: string,
	summaryJa: string,
	importanceScore: number,
	scoreReason: string,
	tags: string[],
): Promise<void> {
	await client.execute(
		`UPDATE articles
     SET status = 'published',
         title_ja = ?,
         summary_ja = ?,
         importance_score = ?,
         score_reason = ?,
         tags = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
		[titleJa, summaryJa, importanceScore, scoreReason, JSON.stringify(tags), articleId],
	);
}

/**
 * Mark an article as 'failed' and increment retry count.
 */
async function failArticle(
	client: D1RestClient,
	articleId: string,
	errorMessage: string,
): Promise<void> {
	await client.execute(
		`UPDATE articles
     SET status = 'failed',
         retry_count = retry_count + 1,
         error_message = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
		[errorMessage.slice(0, 500), articleId],
	);
}

/**
 * Mark all articles in a batch as 'summarizing' (best-effort).
 */
async function markBatchSummarizing(client: D1RestClient, batch: RawArticle[]): Promise<void> {
	for (const article of batch) {
		try {
			await markSummarizing(client, article.id);
		} catch (err) {
			console.error(`Failed to mark ${article.id} as summarizing:`, err);
		}
	}
}

/**
 * Try to fail an article in D1, logging errors silently.
 */
async function tryFailArticle(
	client: D1RestClient,
	articleId: string,
	reason: string,
): Promise<void> {
	try {
		await failArticle(client, articleId, reason);
	} catch (err) {
		console.error(`Failed to update failed status for ${articleId}:`, err);
	}
}

/**
 * Handle a summarization error result.
 */
async function handleSummarizeError(
	client: D1RestClient | null,
	result: SummarizeResult,
	counters: RunCounters,
): Promise<void> {
	const errorMsg = result.error ?? 'Unknown error';
	console.error(`Article ${result.articleId} summarization failed: ${errorMsg}`);
	if (client !== null) {
		await tryFailArticle(client, result.articleId, errorMsg);
	}
	counters.failed++;
}

/**
 * Handle a quality check failure.
 */
async function handleQualityFailure(
	client: D1RestClient | null,
	result: SummarizeResult,
	reason: string,
	counters: RunCounters,
): Promise<void> {
	console.warn(`Article ${result.articleId} quality check failed: ${reason}`);
	if (client !== null) {
		await tryFailArticle(client, result.articleId, reason);
	}
	counters.failed++;
}

/**
 * Handle a successful summarization result (publish or dry-run log).
 */
async function handleSuccess(
	client: D1RestClient | null,
	result: SummarizeResult,
	counters: RunCounters,
): Promise<void> {
	const output = result.output;
	if (output === null) return;

	if (client === null) {
		console.log(
			`[dry-run] Would publish ${result.articleId}: "${output.titleJa}" (score=${output.importanceScore})`,
		);
		counters.published++;
		return;
	}

	try {
		await publishArticle(
			client,
			result.articleId,
			output.titleJa,
			output.summaryJa,
			output.importanceScore,
			output.scoreReason,
			output.tags,
		);
		counters.published++;
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		console.error(`Failed to publish article ${result.articleId}: ${errorMsg}`);
		try {
			await failArticle(client, result.articleId, errorMsg);
		} catch {
			// Best-effort: ignore double-failure
		}
		counters.failed++;
	}
}

/**
 * Process a single summarize result and update counters.
 */
async function processSummarizeResult(
	client: D1RestClient | null,
	result: SummarizeResult,
	counters: RunCounters,
): Promise<void> {
	if (result.error !== null || result.output === null) {
		await handleSummarizeError(client, result, counters);
		return;
	}

	const qualityResult = checkSummaryQuality(result.output);
	if (!qualityResult.passed) {
		const reason = `Quality check failed (score=${qualityResult.score}): ${qualityResult.failures.join('; ')}`;
		await handleQualityFailure(client, result, reason, counters);
		return;
	}

	await handleSuccess(client, result, counters);
}

/**
 * Process one batch of articles: mark, summarize, and write results.
 */
async function processBatch(
	client: D1RestClient,
	batch: RawArticle[],
	claudeApiKey: string,
	dryRun: boolean,
	counters: RunCounters,
): Promise<void> {
	if (!dryRun) {
		await markBatchSummarizing(client, batch);
	}

	const results = await summarizeBatch(claudeApiKey, batch);
	const writeClient = dryRun ? null : client;

	for (const result of results) {
		await processSummarizeResult(writeClient, result, counters);
	}
}

/**
 * Main summarizer entrypoint.
 *
 * Fetches pending articles from D1, processes them through Claude Haiku
 * in batches of 20, validates quality, and writes results back to D1.
 */
export async function summarize(config: SummarizerConfig): Promise<SummaryRunResult> {
	const client = new D1RestClient(
		config.cloudflareAccountId,
		config.d1DatabaseId,
		config.cloudflareApiToken,
	);

	const pending = await fetchPendingArticles(client);
	if (pending.length === 0) {
		console.log('No pending articles to summarize.');
		return { total: 0, published: 0, failed: 0, skipped: 0 };
	}

	console.log(`Found ${pending.length} pending articles. Processing in batches of ${BATCH_SIZE}.`);

	const batches = chunk(pending, BATCH_SIZE);
	const counters: RunCounters = { published: 0, failed: 0 };
	const skipped = 0;

	for (const [batchIndex, batch] of batches.entries()) {
		console.log(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} articles)`);
		await processBatch(client, batch, config.claudeApiKey, config.dryRun ?? false, counters);
	}

	console.log(
		`Summarization complete: ${counters.published} published, ${counters.failed} failed, ${skipped} skipped`,
	);

	return {
		total: pending.length,
		published: counters.published,
		failed: counters.failed,
		skipped,
	};
}

export { summarizeBatch } from './batch.js';
export { buildUserPrompt, SYSTEM_PROMPT } from './prompts.js';
export { checkSummaryQuality } from './quality-check.js';

// --- CLI entry point ---
// Invoked directly by GitHub Actions: node dist/index.js
const argv = process.argv as string[];
if (argv[1]?.endsWith('index.js')) {
	const config: SummarizerConfig = {
		cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
		cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN ?? '',
		d1DatabaseId: process.env.D1_DATABASE_ID ?? '',
		claudeApiKey: process.env.CLAUDE_API_KEY ?? '',
		dryRun: process.env.DRY_RUN === 'true',
	};

	if (
		!config.cloudflareAccountId ||
		!config.cloudflareApiToken ||
		!config.d1DatabaseId ||
		!config.claudeApiKey
	) {
		console.error('[summarizer] Error: Missing required environment variables.');
		console.error('  CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID, CLAUDE_API_KEY');
		process.exit(1);
	}

	summarize(config).catch((err) => {
		console.error('[summarizer] Fatal error:', err);
		process.exit(1);
	});
}
