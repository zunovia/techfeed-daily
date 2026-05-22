import type { RawArticle } from '@techfeed/shared';

/**
 * System prompt for Claude Haiku summarization.
 *
 * cache_control is applied to reduce API costs by up to 90% on repeated calls.
 * @see https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 */
export const SYSTEM_PROMPT = `あなたは日本人エンジニア向けの技術記事キュレーターです。
海外の技術記事を日本語に要約し、重要度スコアを付けます。

【重要度スコア基準（1-100）】
90-100: 業界全体に影響するパラダイムシフト
70-89:  主要フレームワーク/ツールの重大なアップデート
50-69:  実務で役立つ技術解説・ベストプラクティス
30-49:  特定用途に有用な技術情報
1-29:   限定的な情報

【出力形式】必ずJSON形式で出力すること。
{
  "titleJa": "日本語タイトル（40字以内）",
  "summaryJa": "日本語要約（380〜400字。技術的背景→主要な内容→実務への影響の順）",
  "importanceScore": 75,
  "scoreReason": "スコア根拠（100字以内）",
  "tags": ["typescript", "performance"]
}`;

/**
 * System prompt block with cache_control for Anthropic Messages API.
 * Applying ephemeral cache reduces input token cost by up to 90%.
 */
export const SYSTEM_PROMPT_BLOCK = {
	type: 'text' as const,
	text: SYSTEM_PROMPT,
	cache_control: { type: 'ephemeral' as const },
};

/**
 * Build a user prompt for a single article.
 *
 * Includes English title, URL, author, and tags to give Claude
 * enough context for accurate summarization and scoring.
 */
export function buildUserPrompt(article: RawArticle): string {
	const lines: string[] = [
		`タイトル: ${article.titleEn}`,
		`URL: ${article.originalUrl}`,
		`ソース: ${article.source}`,
		`ソーススコア: ${article.sourceScore}`,
	];

	if (article.author) {
		lines.push(`著者: ${article.author}`);
	}

	if (article.tags && article.tags.length > 0) {
		lines.push(`タグ: ${article.tags.join(', ')}`);
	}

	lines.push(`公開日: ${article.publishedAt}`);
	lines.push('');
	lines.push('上記の技術記事を日本語で要約し、指定されたJSON形式で出力してください。');

	return lines.join('\n');
}
