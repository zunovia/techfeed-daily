/**
 * scripts/post-x.ts
 *
 * Posts the top 3 articles of the day to X (Twitter) using X API v2.
 * OAuth 1.0a (HMAC-SHA1) is implemented without external libraries.
 *
 * Usage:
 *   npx tsx scripts/post-x.ts
 *   DRY_RUN=true npx tsx scripts/post-x.ts
 *
 * Required environment variables:
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_API_TOKEN
 *   D1_DATABASE_ID
 *   X_API_KEY
 *   X_API_SECRET
 *   X_ACCESS_TOKEN
 *   X_ACCESS_SECRET
 *
 * Optional:
 *   DRY_RUN=true  — Print tweet text without posting
 */

import { createHmac, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface D1QueryResult<T = Record<string, unknown>> {
	results: T[];
	success: boolean;
	meta: Record<string, unknown>;
}

interface D1ApiResponse<T = Record<string, unknown>> {
	result: D1QueryResult<T>[];
	success: boolean;
	errors: Array<{ code: number; message: string }>;
	messages: string[];
}

interface ArticleRow {
	title_ja: string;
	summary_ja: string;
	importance_score: number;
}

interface XCredentials {
	apiKey: string;
	apiSecret: string;
	accessToken: string;
	accessSecret: string;
}

// ---------------------------------------------------------------------------
// D1 REST Client (minimal, inline — no import from packages to keep script
// self-contained and avoid build-step requirement at call-time)
// ---------------------------------------------------------------------------

async function queryD1<T>(
	accountId: string,
	databaseId: string,
	apiToken: string,
	sql: string,
	params: unknown[] = [],
): Promise<D1ApiResponse<T>> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ sql, params }),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`D1 API error (${response.status}): ${text}`);
	}

	return (await response.json()) as D1ApiResponse<T>;
}

// ---------------------------------------------------------------------------
// OAuth 1.0a helpers
// ---------------------------------------------------------------------------

/** Percent-encode a string per RFC 3986 (used in OAuth signatures). */
function percentEncode(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

/** Generate an OAuth 1.0a Authorization header for a POST request. */
function buildOAuthHeader(
	url: string,
	bodyParams: Record<string, string>,
	credentials: XCredentials,
): string {
	const oauthTimestamp = Math.floor(Date.now() / 1000).toString();
	const oauthNonce = randomBytes(16).toString('hex');

	const oauthParams: Record<string, string> = {
		oauth_consumer_key: credentials.apiKey,
		oauth_nonce: oauthNonce,
		oauth_signature_method: 'HMAC-SHA1',
		oauth_timestamp: oauthTimestamp,
		oauth_token: credentials.accessToken,
		oauth_version: '1.0',
	};

	// Collect all parameters (OAuth + body) and sort alphabetically
	const allParams: Record<string, string> = { ...oauthParams, ...bodyParams };
	const sortedKeys = Object.keys(allParams).sort();
	const paramString = sortedKeys
		.map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
		.join('&');

	// Build signature base string
	const signatureBase = ['POST', percentEncode(url), percentEncode(paramString)].join('&');

	// Build signing key
	const signingKey = `${percentEncode(credentials.apiSecret)}&${percentEncode(credentials.accessSecret)}`;

	// Compute HMAC-SHA1 signature
	const signature = createHmac('sha1', signingKey).update(signatureBase).digest('base64');

	// Build Authorization header value
	const headerParams: Record<string, string> = { ...oauthParams, oauth_signature: signature };
	const headerParts = Object.keys(headerParams)
		.sort()
		.map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k])}"`)
		.join(', ');

	return `OAuth ${headerParts}`;
}

// ---------------------------------------------------------------------------
// Tweet composition
// ---------------------------------------------------------------------------

const NUMBERED_EMOJIS = ['1️⃣', '2️⃣', '3️⃣'];
const RSS_URL = 'https://techfeed-daily.kaneda-ryota.workers.dev/rss';
const SUMMARY_MAX_CHARS = 80;

/** Return today's date in YYYY-MM-DD format (JST). */
function getTodayJst(): string {
	const now = new Date();
	// JST = UTC+9
	const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
	const y = jst.getUTCFullYear();
	const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
	const d = String(jst.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/** Truncate a string to maxChars characters, appending "..." if truncated. */
function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}...`;
}

function composeTweet(articles: ArticleRow[]): string {
	const today = getTodayJst();
	const lines: string[] = [`📰 今日の海外テック記事 TOP3 (${today})`, ''];

	for (let i = 0; i < articles.length; i++) {
		const article = articles[i];
		const emoji = NUMBERED_EMOJIS[i];
		const score = article.importance_score;
		const summary = truncate(article.summary_ja, SUMMARY_MAX_CHARS);

		lines.push(`${emoji} ${article.title_ja} (スコア: ${score})`);
		lines.push(`→ ${summary}`);
		lines.push('');
	}

	lines.push(`🔗 全記事: ${RSS_URL}`);
	lines.push('#テックフィード #海外テック #エンジニア');

	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// X API v2 — Post tweet
// ---------------------------------------------------------------------------

const X_TWEET_URL = 'https://api.twitter.com/2/tweets';

async function postTweet(text: string, credentials: XCredentials): Promise<void> {
	const bodyJson = JSON.stringify({ text });
	// For JSON bodies, OAuth signature uses an empty body params object
	// (JSON body is NOT included in OAuth parameter collection per spec)
	const authHeader = buildOAuthHeader(X_TWEET_URL, {}, credentials);

	const response = await fetch(X_TWEET_URL, {
		method: 'POST',
		headers: {
			Authorization: authHeader,
			'Content-Type': 'application/json',
		},
		body: bodyJson,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`X API error (${response.status}): ${errorText}`);
	}

	const data = (await response.json()) as { data?: { id?: string } };
	console.log(`Tweet posted successfully. ID: ${data.data?.id ?? 'unknown'}`);
}

// ---------------------------------------------------------------------------
// D1 fetch helper
// ---------------------------------------------------------------------------

async function fetchTop3Articles(
	accountId: string,
	databaseId: string,
	apiToken: string,
	date: string,
): Promise<ArticleRow[]> {
	const sql = `
		SELECT title_ja, summary_ja, importance_score
		FROM articles
		WHERE status = 'published'
		  AND DATE(collected_at) = ?
		ORDER BY importance_score DESC
		LIMIT 3
	`;

	const result = await queryD1<ArticleRow>(accountId, databaseId, apiToken, sql, [date]);

	if (!result.success) {
		const msgs = result.errors.map((e) => `[${e.code}] ${e.message}`).join(', ');
		throw new Error(`D1 query failed: ${msgs}`);
	}

	return result.result[0]?.results ?? [];
}

// ---------------------------------------------------------------------------
// Dry-run mode
// ---------------------------------------------------------------------------

const PLACEHOLDER_ARTICLES: ArticleRow[] = [
	{
		title_ja: 'TypeScriptの新機能でコードが劇的に改善される',
		summary_ja:
			'TypeScript 5.5では型推論が強化され、開発者の生産性が大幅に向上する新機能が追加されました。',
		importance_score: 85,
	},
	{
		title_ja: 'Rustが2024年最もトレンドの言語にランクイン',
		summary_ja:
			'Stack Overflow調査でRustが再び最も愛される言語に選ばれ、採用率も前年比30%増加した。',
		importance_score: 72,
	},
	{
		title_ja: 'OpenAIが新しいAPIエンドポイントを発表',
		summary_ja:
			'新しいRealtime APIにより、音声とテキストをリアルタイムで処理できるアプリの開発が可能になった。',
		importance_score: 68,
	},
];

async function runDryRun(): Promise<void> {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
	const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? '';
	const databaseId = process.env.D1_DATABASE_ID ?? '';

	let articles: ArticleRow[];

	if (accountId && apiToken && databaseId) {
		const today = getTodayJst();
		console.log(`[DRY_RUN] Fetching top 3 articles for ${today}...`);
		articles = await fetchTop3Articles(accountId, databaseId, apiToken, today);
	} else {
		console.log('[DRY_RUN] No D1 credentials — using placeholder data.');
		articles = PLACEHOLDER_ARTICLES;
	}

	if (articles.length === 0) {
		console.log('[DRY_RUN] No published articles found for today.');
		return;
	}

	const tweet = composeTweet(articles);
	console.log('\n[DRY_RUN] Tweet content:');
	console.log('─'.repeat(50));
	console.log(tweet);
	console.log('─'.repeat(50));
	console.log(`\nCharacter count: ${tweet.length}`);
}

// ---------------------------------------------------------------------------
// Production mode
// ---------------------------------------------------------------------------

async function runProduction(): Promise<void> {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
	const apiToken = process.env.CLOUDFLARE_API_TOKEN;
	const databaseId = process.env.D1_DATABASE_ID;
	const xApiKey = process.env.X_API_KEY;
	const xApiSecret = process.env.X_API_SECRET;
	const xAccessToken = process.env.X_ACCESS_TOKEN;
	const xAccessSecret = process.env.X_ACCESS_SECRET;

	const missing: string[] = [];
	if (!accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
	if (!apiToken) missing.push('CLOUDFLARE_API_TOKEN');
	if (!databaseId) missing.push('D1_DATABASE_ID');
	if (!xApiKey) missing.push('X_API_KEY');
	if (!xApiSecret) missing.push('X_API_SECRET');
	if (!xAccessToken) missing.push('X_ACCESS_TOKEN');
	if (!xAccessSecret) missing.push('X_ACCESS_SECRET');

	if (missing.length > 0) {
		console.error('Error: Missing required environment variables:');
		for (const v of missing) {
			console.error(`  ${v}`);
		}
		process.exit(1);
	}

	const today = getTodayJst();
	console.log(`Fetching top 3 articles for ${today}...`);

	// biome-ignore lint/style/noNonNullAssertion: checked above
	const articles = await fetchTop3Articles(accountId!, databaseId!, apiToken!, today);

	if (articles.length === 0) {
		console.log('No published articles found for today. Skipping tweet.');
		return;
	}

	const tweet = composeTweet(articles);
	console.log('Composing tweet:');
	console.log(tweet);
	console.log(`Character count: ${tweet.length}`);

	console.log('Posting to X...');
	await postTweet(tweet, {
		// biome-ignore lint/style/noNonNullAssertion: checked above
		apiKey: xApiKey!,
		// biome-ignore lint/style/noNonNullAssertion: checked above
		apiSecret: xApiSecret!,
		// biome-ignore lint/style/noNonNullAssertion: checked above
		accessToken: xAccessToken!,
		// biome-ignore lint/style/noNonNullAssertion: checked above
		accessSecret: xAccessSecret!,
	});
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const dryRun = process.env.DRY_RUN === 'true';
	if (dryRun) {
		await runDryRun();
	} else {
		await runProduction();
	}
}

main().catch((err: unknown) => {
	console.error('Unexpected error:', err);
	process.exit(1);
});
