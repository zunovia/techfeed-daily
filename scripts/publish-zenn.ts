/**
 * scripts/publish-zenn.ts
 *
 * Publishes the top 10 articles of the day to Zenn via GitHub API.
 * Zenn's GitHub integration automatically publishes articles when
 * markdown files are pushed to the connected repository.
 *
 * Usage:
 *   npx tsx scripts/publish-zenn.ts
 *   DRY_RUN=true npx tsx scripts/publish-zenn.ts
 *
 * Required environment variables:
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_API_TOKEN
 *   D1_DATABASE_ID
 *   GITHUB_TOKEN           — Personal access token with repo scope
 *
 * Optional:
 *   ZENN_REPO               — GitHub repo (default: zunovia/zenn-content)
 *   DRY_RUN=true            — Print article content without publishing
 */

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
	tags: string;
	original_url: string;
}

interface GitHubContentResponse {
	sha: string;
	content?: string;
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
// Date helpers
// ---------------------------------------------------------------------------

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

/** Format YYYY-MM-DD to YYYY/MM/DD for display. */
function formatDateSlash(date: string): string {
	return date.replace(/-/g, '/');
}

// ---------------------------------------------------------------------------
// Zenn article composition
// ---------------------------------------------------------------------------

const MAX_ARTICLES = 10;
const SITE_URL = 'https://techfeed-daily.kaneda-ryota.workers.dev';

function buildFrontmatter(date: string): string {
	const lines = [
		'---',
		`title: "【自動配信】海外テックニュース日本語まとめ ${formatDateSlash(date)}"`,
		'emoji: "📰"',
		'type: "tech"',
		'topics: ["tech", "ai", "海外テック", "ニュース"]',
		`published: ${process.env.ZENN_PUBLISHED !== 'false'}`,
		'---',
	];
	return lines.join('\n');
}

function buildArticleBody(articles: ArticleRow[]): string {
	const lines: string[] = [
		'## 今日のハイライト',
		'',
		`> 本記事は [TechFeed Daily](${SITE_URL}) が自動生成しています。`,
		'',
		'---',
		'',
	];

	for (let i = 0; i < articles.length; i++) {
		const article = articles[i];
		const num = i + 1;

		// Parse tags (stored as JSON string in D1)
		let tagsDisplay: string;
		try {
			const parsed = JSON.parse(article.tags) as string[];
			tagsDisplay = parsed.map((t) => `\`${t}\``).join(', ');
		} catch {
			tagsDisplay = article.tags;
		}

		lines.push(`### ${num}. ${article.title_ja}`);
		lines.push(`**重要度: ${article.importance_score}/10** | タグ: ${tagsDisplay}`);
		lines.push('');
		lines.push(article.summary_ja);
		lines.push('');
		lines.push(`🔗 [原文を読む](${article.original_url})`);
		lines.push('');
		lines.push('---');
		lines.push('');
	}

	lines.push('*この記事は TechFeed Daily により自動生成されました。*');
	lines.push('*海外テックニュースを毎日自動で収集・要約・配信しています。*');

	return lines.join('\n');
}

function composeZennArticle(date: string, articles: ArticleRow[]): string {
	const frontmatter = buildFrontmatter(date);
	const body = buildArticleBody(articles);
	return `${frontmatter}\n\n${body}\n`;
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

const GITHUB_API_BASE = 'https://api.github.com';

/** Get existing file SHA (needed for updates). Returns null if file doesn't exist. */
async function getFileSha(repo: string, path: string, token: string): Promise<string | null> {
	const url = `${GITHUB_API_BASE}/repos/${repo}/contents/${path}`;
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github.v3+json',
		},
	});

	if (response.status === 404) {
		return null;
	}

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`GitHub API GET error (${response.status}): ${text}`);
	}

	const data = (await response.json()) as GitHubContentResponse;
	return data.sha;
}

/** Create or update a file in the GitHub repository. */
async function putFileToGitHub(
	repo: string,
	path: string,
	content: string,
	token: string,
	message: string,
): Promise<void> {
	// Check if file already exists to get SHA for update
	const existingSha = await getFileSha(repo, path, token);

	const url = `${GITHUB_API_BASE}/repos/${repo}/contents/${path}`;

	// Content must be base64-encoded
	const contentBase64 = Buffer.from(content, 'utf-8').toString('base64');

	const body: Record<string, string> = {
		message,
		content: contentBase64,
	};

	if (existingSha) {
		body.sha = existingSha;
		console.log(`File already exists (SHA: ${existingSha.slice(0, 7)}). Updating...`);
	} else {
		console.log('Creating new file...');
	}

	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github.v3+json',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`GitHub API PUT error (${response.status}): ${text}`);
	}

	const action = existingSha ? 'updated' : 'created';
	console.log(`File ${action} successfully: ${path}`);
}

// ---------------------------------------------------------------------------
// D1 fetch helper
// ---------------------------------------------------------------------------

async function fetchTopArticles(
	accountId: string,
	databaseId: string,
	apiToken: string,
): Promise<ArticleRow[]> {
	// collected_at is stored in UTC. When the pipeline runs at UTC 22:00 (JST 07:00),
	// articles are collected on the previous UTC date. Query the last 24 hours instead
	// of matching by exact UTC date.
	const sql = `
		SELECT title_ja, summary_ja, importance_score, tags, original_url
		FROM articles
		WHERE status = 'published'
		  AND collected_at >= datetime('now', '-24 hours')
		ORDER BY importance_score DESC
		LIMIT ?
	`;

	const result = await queryD1<ArticleRow>(accountId, databaseId, apiToken, sql, [MAX_ARTICLES]);

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
		tags: '["TypeScript","開発ツール"]',
		original_url: 'https://example.com/typescript-new-features',
	},
	{
		title_ja: 'Rustが2024年最もトレンドの言語にランクイン',
		summary_ja:
			'Stack Overflow調査でRustが再び最も愛される言語に選ばれ、採用率も前年比30%増加した。',
		importance_score: 72,
		tags: '["Rust","プログラミング言語"]',
		original_url: 'https://example.com/rust-trending',
	},
	{
		title_ja: 'OpenAIが新しいAPIエンドポイントを発表',
		summary_ja:
			'新しいRealtime APIにより、音声とテキストをリアルタイムで処理できるアプリの開発が可能になった。',
		importance_score: 68,
		tags: '["AI","API"]',
		original_url: 'https://example.com/openai-new-api',
	},
];

async function runDryRun(): Promise<void> {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
	const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? '';
	const databaseId = process.env.D1_DATABASE_ID ?? '';

	let articles: ArticleRow[];
	const today = getTodayJst();

	if (accountId && apiToken && databaseId) {
		console.log(`[DRY_RUN] Fetching top ${MAX_ARTICLES} articles for ${today}...`);
		articles = await fetchTopArticles(accountId, databaseId, apiToken);
	} else {
		console.log('[DRY_RUN] No D1 credentials — using placeholder data.');
		articles = PLACEHOLDER_ARTICLES;
	}

	if (articles.length === 0) {
		console.log('[DRY_RUN] No published articles found for today.');
		return;
	}

	const articleContent = composeZennArticle(today, articles);
	const filePath = `articles/techfeed-daily-${today}.md`;

	console.log(`\n[DRY_RUN] File path: ${filePath}`);
	console.log('[DRY_RUN] Article content:');
	console.log('─'.repeat(60));
	console.log(articleContent);
	console.log('─'.repeat(60));
	console.log(`\nCharacter count: ${articleContent.length}`);
	console.log(`Articles included: ${articles.length}`);
}

// ---------------------------------------------------------------------------
// Production mode
// ---------------------------------------------------------------------------

async function runProduction(): Promise<void> {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
	const apiToken = process.env.CLOUDFLARE_API_TOKEN;
	const databaseId = process.env.D1_DATABASE_ID;
	const githubToken = process.env.GITHUB_TOKEN;

	const missing: string[] = [];
	if (!accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
	if (!apiToken) missing.push('CLOUDFLARE_API_TOKEN');
	if (!databaseId) missing.push('D1_DATABASE_ID');
	if (!githubToken) missing.push('GITHUB_TOKEN');

	if (missing.length > 0) {
		console.error('Error: Missing required environment variables:');
		for (const v of missing) {
			console.error(`  ${v}`);
		}
		process.exit(1);
	}

	const zennRepo = process.env.ZENN_REPO ?? 'zunovia/zenn-content';
	const today = getTodayJst();

	console.log(`Fetching top ${MAX_ARTICLES} articles for ${today}...`);

	// biome-ignore lint/style/noNonNullAssertion: checked above
	const articles = await fetchTopArticles(accountId!, databaseId!, apiToken!);

	if (articles.length === 0) {
		console.log('No published articles found for today. Skipping Zenn publish.');
		return;
	}

	console.log(`Found ${articles.length} articles.`);

	const articleContent = composeZennArticle(today, articles);
	const filePath = `articles/techfeed-daily-${today}.md`;

	console.log(`Publishing to Zenn (${zennRepo})...`);
	console.log(`File: ${filePath}`);

	await putFileToGitHub(
		zennRepo,
		filePath,
		articleContent,
		// biome-ignore lint/style/noNonNullAssertion: checked above
		githubToken!,
		`chore: add TechFeed Daily ${today}`,
	);

	console.log('Zenn article published successfully.');
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
