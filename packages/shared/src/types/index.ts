export type ArticleSource = 'hackernews' | 'devto' | 'github_trending';
export type ArticleStatus = 'pending' | 'summarizing' | 'published' | 'failed' | 'skipped';

export interface RawArticle {
	id: string;
	source: ArticleSource;
	originalUrl: string;
	titleEn: string;
	author?: string;
	publishedAt: string;
	sourceScore: number;
	tags?: string[];
}

export interface ClaudeSummaryOutput {
	titleJa: string;
	summaryJa: string;
	importanceScore: number;
	scoreReason: string;
	tags: string[];
}

export interface Article {
	id: string;
	source: ArticleSource;
	originalUrl: string;
	titleEn: string;
	titleJa?: string;
	summaryJa?: string;
	importanceScore: number;
	scoreReason?: string;
	tags: string[];
	author?: string;
	publishedAt: string;
	collectedAt: string;
	status: ArticleStatus;
	retryCount: number;
	errorMessage?: string;
	sourceScore: number;
	createdAt: string;
	updatedAt: string;
}

export interface ArticleResponse {
	id: string;
	source: ArticleSource;
	originalUrl: string;
	titleJa: string;
	summaryJa: string;
	importanceScore: number;
	tags: string[];
	author?: string;
	publishedAt: string;
}

export interface ApiResponse<T> {
	data: T;
	meta: {
		date: string;
		totalCount: number;
		generatedAt: string;
		nextUpdate: string;
	};
}

/** D1 REST API query result */
export interface D1QueryResult<T = Record<string, unknown>> {
	results: T[];
	success: boolean;
	meta: {
		changes: number;
		duration: number;
		last_row_id: number;
		rows_read: number;
		rows_written: number;
	};
}

export interface D1ApiResponse<T = Record<string, unknown>> {
	result: D1QueryResult<T>[];
	success: boolean;
	errors: Array<{ code: number; message: string }>;
	messages: string[];
}

/** Collection configuration */
export interface CollectorConfig {
	cloudflareAccountId: string;
	cloudflareApiToken: string;
	d1DatabaseId: string;
	dryRun?: boolean;
}

/** Collection run result */
export interface CollectionResult {
	source: ArticleSource;
	articlesFound: number;
	articlesSaved: number;
	articlesSkipped: number;
	errors: string[];
}
