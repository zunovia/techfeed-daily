import type { ClaudeSummaryOutput, RawArticle } from '@techfeed/shared';
import { buildUserPrompt, SYSTEM_PROMPT_BLOCK } from './prompts.js';

/** Claude model used for summarization */
const CLAUDE_MODEL = 'claude-haiku-4-5';

/** Maximum tokens for summary response */
const MAX_TOKENS = 600;

/** Maximum retry attempts for transient failures */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const RETRY_BASE_DELAY_MS = 1000;

/** Claude API endpoint */
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Anthropic Messages API response shape.
 */
interface AnthropicResponse {
	content: Array<{
		type: string;
		text: string;
	}>;
	usage?: {
		input_tokens: number;
		output_tokens: number;
	};
}

/**
 * Result for a single article summarization attempt.
 */
export interface SummarizeResult {
	articleId: string;
	output: ClaudeSummaryOutput | null;
	error: string | null;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine if an HTTP status code is retryable.
 */
function isRetryableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

/**
 * Call Claude Messages API once (single attempt, no retry).
 * Throws for non-retryable errors, returns error string for retryable ones.
 */
async function callClaudeOnce(apiKey: string, userPrompt: string): Promise<AnthropicResponse> {
	const response = await fetch(CLAUDE_API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-API-Key': apiKey,
			'anthropic-version': '2023-06-01',
			'anthropic-beta': 'prompt-caching-2024-07-31',
		},
		body: JSON.stringify({
			model: CLAUDE_MODEL,
			max_tokens: MAX_TOKENS,
			system: [SYSTEM_PROMPT_BLOCK],
			messages: [{ role: 'user', content: userPrompt }],
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		const msg = `Claude API error (${response.status}): ${text}`;
		if (isRetryableStatus(response.status)) {
			throw new RetryableError(msg);
		}
		throw new Error(msg);
	}

	return (await response.json()) as AnthropicResponse;
}

/**
 * Marker error class for retryable failures.
 */
class RetryableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RetryableError';
	}
}

/**
 * Call Claude Messages API with exponential backoff retry.
 *
 * Uses cache_control on the system prompt to reduce costs by up to 90%.
 *
 * @param apiKey - Anthropic API key
 * @param article - Article to summarize
 * @returns Parsed ClaudeSummaryOutput
 */
async function callClaudeWithRetry(
	apiKey: string,
	article: RawArticle,
): Promise<ClaudeSummaryOutput> {
	const userPrompt = buildUserPrompt(article);
	let lastError: Error = new Error('Max retries exceeded');

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		if (attempt > 0) {
			await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
		}
		try {
			const data = await callClaudeOnce(apiKey, userPrompt);
			return extractAndParse(data);
		} catch (err) {
			if (err instanceof RetryableError) {
				lastError = err;
				continue;
			}
			throw err;
		}
	}

	throw lastError;
}

/**
 * Extract text content from API response and parse as ClaudeSummaryOutput.
 */
function extractAndParse(data: AnthropicResponse): ClaudeSummaryOutput {
	const textContent = data.content.find((c) => c.type === 'text');
	if (!textContent) {
		throw new Error('No text content in Claude response');
	}
	return parseClaudeResponse(textContent.text);
}

/**
 * Parse Claude's JSON text response into ClaudeSummaryOutput.
 *
 * Handles cases where Claude wraps the JSON in a code block.
 */
function parseClaudeResponse(text: string): ClaudeSummaryOutput {
	// Strip optional markdown code block wrapper
	const jsonText = text
		.replace(/^```(?:json)?\s*/m, '')
		.replace(/\s*```\s*$/m, '')
		.trim();

	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch {
		throw new Error(`Failed to parse Claude JSON response: ${text.slice(0, 200)}`);
	}

	if (!isValidClaudeSummaryOutput(parsed)) {
		throw new Error(`Invalid Claude response structure: ${JSON.stringify(parsed).slice(0, 200)}`);
	}

	return parsed;
}

/**
 * Type guard for ClaudeSummaryOutput.
 */
function isValidClaudeSummaryOutput(value: unknown): value is ClaudeSummaryOutput {
	if (typeof value !== 'object' || value === null) return false;
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.titleJa === 'string' &&
		typeof obj.summaryJa === 'string' &&
		typeof obj.importanceScore === 'number' &&
		typeof obj.scoreReason === 'string' &&
		Array.isArray(obj.tags)
	);
}

/**
 * Summarize a batch of articles using Claude Messages API.
 *
 * Processes articles sequentially within the batch.
 * Uses prompt caching on the system prompt to minimize costs.
 *
 * @param apiKey - Anthropic API key
 * @param articles - Articles to summarize (recommend <= 20 per batch)
 * @returns Array of results, one per article
 */
export async function summarizeBatch(
	apiKey: string,
	articles: RawArticle[],
): Promise<SummarizeResult[]> {
	const results: SummarizeResult[] = [];

	for (const article of articles) {
		try {
			const output = await callClaudeWithRetry(apiKey, article);
			results.push({ articleId: article.id, output, error: null });
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			results.push({ articleId: article.id, output: null, error });
		}
	}

	return results;
}
