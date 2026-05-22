import type { Article } from '../types/index.js';

/**
 * Escape a string for use inside XML CDATA sections.
 * CDATA sections cannot contain the literal sequence "]]>".
 * We split it as ]]>]]><![CDATA[ to avoid that.
 */
function escapeCdata(text: string): string {
	return text.replace(/]]>/g, ']]>]]><![CDATA[');
}

/**
 * Escape a string for use as an XML attribute or element text value.
 */
function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * Format a date string as RFC-2822 for RSS pubDate.
 * Input is ISO 8601 (e.g. "2026-05-22T06:00:00Z").
 */
function toRfc2822(isoDate: string): string {
	return new Date(isoDate).toUTCString();
}

export interface RssBuildOptions {
	/** Feed base URL, e.g. https://techfeed-daily.example.workers.dev */
	baseUrl: string;
	/** Date for which this feed was generated (YYYY-MM-DD) */
	date: string;
}

/**
 * Build an RSS 2.0 XML string from an array of published articles.
 *
 * Articles should already be sorted by importance_score descending and
 * limited to TOP 30 by the caller.
 */
export function buildRssXml(articles: Article[], options: RssBuildOptions): string {
	const { baseUrl, date } = options;
	const now = new Date().toUTCString();
	const feedUrl = `${baseUrl}/rss/${date}`;
	const articlesUrl = `${baseUrl}/api/articles/${date}`;

	const items = articles
		.map((article) => {
			const title = article.titleJa ?? article.titleEn;
			const description = article.summaryJa ?? '';
			const author = article.author ?? 'Unknown';
			const tags = article.tags.map((t) => `<category>${escapeXml(t)}</category>`).join('\n      ');

			return `    <item>
      <title><![CDATA[${escapeCdata(title)}]]></title>
      <link>${escapeXml(article.originalUrl)}</link>
      <guid isPermaLink="false">${escapeXml(article.id)}</guid>
      <pubDate>${toRfc2822(article.publishedAt)}</pubDate>
      <dc:creator><![CDATA[${escapeCdata(author)}]]></dc:creator>
      <description><![CDATA[${escapeCdata(description)}]]></description>
      ${tags}
      <techfeed:importanceScore>${article.importanceScore}</techfeed:importanceScore>
    </item>`;
		})
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:techfeed="https://techfeed-daily.dev/ns/1.0">
  <channel>
    <title>TechFeed Daily — ${date}</title>
    <link>${escapeXml(articlesUrl)}</link>
    <description><![CDATA[海外技術記事の日本語要約フィード (${date})]]></description>
    <language>ja</language>
    <pubDate>${now}</pubDate>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
}
