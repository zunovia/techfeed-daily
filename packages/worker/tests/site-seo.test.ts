/**
 * site-seo.test.ts
 *
 * Pure-function tests for SEO features added to site.ts:
 *   - jsonLd() output safety (JSON syntax, </script> injection)
 *   - isPublicPath() logic (robots.txt / sitemap.xml bypass auth)
 *   - canonicalPath rendering safety (XSS via date parameter)
 *   - robots.txt body format
 *   - sitemap.xml URL construction (XML-special character safety)
 *
 * These functions are inlined here to avoid Workers-runtime-specific imports
 * (Hono, D1Database, etc.) that cannot run in a plain Vitest/Node environment.
 * The logic is kept identical to site.ts and auth.ts.
 */

import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Inlined helpers (mirrors site.ts)
// ---------------------------------------------------------------------------

const SITE_URL = 'https://news.surc.online';
const HOME_URL = 'https://surc.online/';
const HOME_LABEL = 'Sur Communication';
const SITE_NAME = 'TechFeed Daily';

function esc(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function jsonLd(): string {
	const data = {
		'@context': 'https://schema.org',
		'@graph': [
			{
				'@type': 'Organization',
				'@id': `${HOME_URL}#org`,
				name: HOME_LABEL,
				url: HOME_URL,
			},
			{
				'@type': 'WebSite',
				'@id': `${SITE_URL}/#website`,
				name: SITE_NAME,
				alternateName: 'news.surc.online',
				url: `${SITE_URL}/`,
				description:
					'海外テックニュースを毎日、日本語で。Hacker News・DEV.to・GitHub Trending から自動収集した記事をAIが要約し、毎朝7時(JST)に配信するニュースメディア。',
				inLanguage: 'ja',
				publisher: { '@id': `${HOME_URL}#org` },
			},
		],
	};
	return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function buildCanonicalHref(canonicalPath: string): string {
	return `${SITE_URL}${esc(canonicalPath)}`;
}

function buildRobotsTxt(): string {
	return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

interface UrlEntry {
	loc: string;
	lastmod: string;
	freq: string;
}

function buildSitemapXml(urls: UrlEntry[]): string {
	const urlsXml = urls
		.map(
			(u) =>
				`  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.freq}</changefreq></url>`,
		)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlsXml}\n</urlset>\n`;
}

// ---------------------------------------------------------------------------
// Inlined isPublicPath (mirrors auth.ts)
// ---------------------------------------------------------------------------

const PUBLIC_PATHS = [
	'/rss',
	'/api/articles',
	'/api/health',
	'/img',
	'/d',
	'/archive',
	'/robots.txt',
	'/sitemap.xml',
];

function isPublicPath(path: string): boolean {
	if (path === '/') return true;
	return PUBLIC_PATHS.some(
		(p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`),
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('jsonLd()', () => {
	it('produces valid JSON wrapped in a script tag', () => {
		const output = jsonLd();
		expect(output).toMatch(/^<script type="application\/ld\+json">/);
		expect(output).toMatch(/<\/script>$/);
		const jsonStr = output
			.replace(/<script type="application\/ld\+json">/, '')
			.replace(/<\/script>$/, '');
		expect(() => JSON.parse(jsonStr)).not.toThrow();
	});

	it('does not contain a raw </script> sequence inside the JSON string', () => {
		const output = jsonLd();
		// Strip the outer <script>...</script> wrapper
		const jsonStr = output
			.replace(/<script type="application\/ld\+json">/, '')
			.replace(/<\/script>$/, '');
		// Dangerous sequence would allow HTML injection out of the script block
		expect(jsonStr).not.toContain('</script>');
	});

	it('does not contain unescaped < characters in the JSON string (XSS safety)', () => {
		const output = jsonLd();
		const jsonStr = output
			.replace(/<script type="application\/ld\+json">/, '')
			.replace(/<\/script>$/, '');
		// JSON.stringify does not HTML-escape < > by default, but our fixed strings must not contain them
		const data = JSON.parse(jsonStr) as Record<string, unknown>;
		expect(data['@context']).toBe('https://schema.org');
		const graph = data['@graph'] as Array<Record<string, unknown>>;
		expect(graph).toHaveLength(2);
		// Verify none of the string values contain raw HTML tags
		for (const node of graph) {
			for (const [, v] of Object.entries(node)) {
				if (typeof v === 'string') {
					expect(v).not.toMatch(/<[a-z]/i);
				}
			}
		}
	});

	it('includes correct Organization and WebSite types', () => {
		const output = jsonLd();
		const jsonStr = output
			.replace(/<script type="application\/ld\+json">/, '')
			.replace(/<\/script>$/, '');
		const data = JSON.parse(jsonStr) as {
			'@context': string;
			'@graph': Array<{ '@type': string }>;
		};
		const types = data['@graph'].map((n) => n['@type']);
		expect(types).toContain('Organization');
		expect(types).toContain('WebSite');
	});

	it('uses SITE_URL as the WebSite URL', () => {
		const output = jsonLd();
		expect(output).toContain(SITE_URL);
	});
});

describe('canonicalPath rendering', () => {
	it('top page canonical is SITE_URL + /', () => {
		const href = buildCanonicalHref('/');
		expect(href).toBe('https://news.surc.online/');
	});

	it('archive page canonical is SITE_URL + /archive (hardcoded in renderArchivePage)', () => {
		// renderArchivePage uses ${SITE_URL}/archive directly, no esc() needed
		const canonical = `${SITE_URL}/archive`;
		expect(canonical).toBe('https://news.surc.online/archive');
	});

	it('date page canonical uses esc() on the path', () => {
		const date = '2026-07-17';
		const href = buildCanonicalHref(`/d/${date}`);
		expect(href).toBe('https://news.surc.online/d/2026-07-17');
	});

	it('esc() neutralises XSS in canonicalPath (defence-in-depth, route regex blocks first)', () => {
		// This path would be rejected by /^\d{4}-\d{2}-\d{2}$/ before reaching renderPage,
		// but esc() provides a second layer of safety.
		const malicious = '/d/<script>alert(1)</script>';
		const href = buildCanonicalHref(malicious);
		expect(href).not.toContain('<script>');
		expect(href).toContain('&lt;script&gt;');
	});

	it('esc() neutralises quote injection in canonicalPath', () => {
		const malicious = '/d/2026-07-17"onload=alert(1)';
		const href = buildCanonicalHref(malicious);
		expect(href).not.toContain('"onload=');
		expect(href).toContain('&quot;onload=');
	});
});

describe('isPublicPath() — auth middleware bypass rules', () => {
	it('allows root /', () => {
		expect(isPublicPath('/')).toBe(true);
	});

	it('allows /robots.txt', () => {
		expect(isPublicPath('/robots.txt')).toBe(true);
	});

	it('allows /sitemap.xml', () => {
		expect(isPublicPath('/sitemap.xml')).toBe(true);
	});

	it('allows /archive', () => {
		expect(isPublicPath('/archive')).toBe(true);
	});

	it('allows /d/2026-07-17 (date sub-path)', () => {
		expect(isPublicPath('/d/2026-07-17')).toBe(true);
	});

	it('allows /rss', () => {
		expect(isPublicPath('/rss')).toBe(true);
	});

	it('allows /api/articles', () => {
		expect(isPublicPath('/api/articles')).toBe(true);
	});

	it('allows /img/hero/2026-07-17', () => {
		expect(isPublicPath('/img/hero/2026-07-17')).toBe(true);
	});

	it('blocks /api/keys (requires auth)', () => {
		expect(isPublicPath('/api/keys')).toBe(false);
	});

	it('does not allow /robots.txt.evil as a /robots.txt bypass', () => {
		// path === '/robots.txt' is exact match; .startsWith('/robots.txt/') and
		// .startsWith('/robots.txt?') do not match '/robots.txt.evil'
		expect(isPublicPath('/robots.txt.evil')).toBe(false);
	});

	it('does not allow /sitemap.xml.hack as a /sitemap.xml bypass', () => {
		expect(isPublicPath('/sitemap.xml.hack')).toBe(false);
	});

	it('does not allow /robots.txtsomething as a bypass', () => {
		expect(isPublicPath('/robots.txtsomething')).toBe(false);
	});
});

describe('robots.txt format', () => {
	it('contains User-agent wildcard', () => {
		const body = buildRobotsTxt();
		expect(body).toContain('User-agent: *');
	});

	it('contains Allow: /', () => {
		const body = buildRobotsTxt();
		expect(body).toContain('Allow: /');
	});

	it('contains correct Sitemap URL', () => {
		const body = buildRobotsTxt();
		expect(body).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
	});

	it('ends with newline', () => {
		const body = buildRobotsTxt();
		expect(body.endsWith('\n')).toBe(true);
	});
});

describe('sitemap.xml construction', () => {
	const sampleDays = [
		{ date: '2026-07-17', count: 25 },
		{ date: '2026-07-16', count: 30 },
	];

	function buildUrls(days: typeof sampleDays): UrlEntry[] {
		const today = '2026-07-17';
		const staticUrls: UrlEntry[] = [
			{ loc: `${SITE_URL}/`, lastmod: today, freq: 'daily' },
			{ loc: `${SITE_URL}/archive`, lastmod: today, freq: 'daily' },
		];
		const dayUrls: UrlEntry[] = days.map((d) => ({
			loc: `${SITE_URL}/d/${d.date}`,
			lastmod: d.date,
			freq: 'never',
		}));
		return [...staticUrls, ...dayUrls];
	}

	it('starts with XML declaration', () => {
		const xml = buildSitemapXml(buildUrls(sampleDays));
		expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
	});

	it('wraps in urlset with correct namespace', () => {
		const xml = buildSitemapXml(buildUrls(sampleDays));
		expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
	});

	it('includes top-page URL', () => {
		const xml = buildSitemapXml(buildUrls(sampleDays));
		expect(xml).toContain(`<loc>${SITE_URL}/</loc>`);
	});

	it('includes archive URL', () => {
		const xml = buildSitemapXml(buildUrls(sampleDays));
		expect(xml).toContain(`<loc>${SITE_URL}/archive</loc>`);
	});

	it('includes date-based URLs for each day', () => {
		const xml = buildSitemapXml(buildUrls(sampleDays));
		expect(xml).toContain(`<loc>${SITE_URL}/d/2026-07-17</loc>`);
		expect(xml).toContain(`<loc>${SITE_URL}/d/2026-07-16</loc>`);
	});

	it('has correct total URL count (2 static + N days)', () => {
		const xml = buildSitemapXml(buildUrls(sampleDays));
		const matches = xml.match(/<url>/g) ?? [];
		expect(matches).toHaveLength(2 + sampleDays.length);
	});

	it('date-based URLs contain no XML-special characters', () => {
		const urls = buildUrls(sampleDays);
		for (const u of urls) {
			// loc values from D1 dates (YYYY-MM-DD) plus SITE_URL should be XML-safe
			expect(u.loc).not.toMatch(/[<>&'"]/);
		}
	});

	it('ends with closing urlset tag and newline', () => {
		const xml = buildSitemapXml(buildUrls(sampleDays));
		expect(xml.trim()).toMatch(/<\/urlset>$/);
	});

	it('top-page and archive have changefreq=daily', () => {
		const xml = buildSitemapXml(buildUrls(sampleDays));
		// Both static URLs should carry changefreq=daily
		const topMatch = xml.match(
			new RegExp(
				`<url><loc>${SITE_URL.replace(/\./g, '\\.')}/</loc>[^<]*<lastmod>[^<]+</lastmod><changefreq>([^<]+)</changefreq></url>`,
			),
		);
		expect(topMatch?.[1]).toBe('daily');
		const archiveMatch = xml.match(
			new RegExp(
				`<url><loc>${SITE_URL.replace(/\./g, '\\.')}/archive</loc>[^<]*<lastmod>[^<]+</lastmod><changefreq>([^<]+)</changefreq></url>`,
			),
		);
		expect(archiveMatch?.[1]).toBe('daily');
	});

	it('date-based pages have changefreq=never', () => {
		const xml = buildSitemapXml(buildUrls(sampleDays));
		const dateMatch = xml.match(
			/<url><loc>[^<]+\/d\/2026-07-17<\/loc><lastmod>[^<]+<\/lastmod><changefreq>([^<]+)<\/changefreq><\/url>/,
		);
		expect(dateMatch?.[1]).toBe('never');
	});

	it('every <url> element contains a <changefreq> element', () => {
		const xml = buildSitemapXml(buildUrls(sampleDays));
		const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
		expect(urlBlocks.length).toBeGreaterThan(0);
		for (const block of urlBlocks) {
			expect(block).toContain('<changefreq>');
		}
	});

	it('handles empty days list (no archive dates yet)', () => {
		const xml = buildSitemapXml(buildUrls([]));
		// Should still include top and archive static URLs
		expect(xml).toContain(`<loc>${SITE_URL}/</loc>`);
		expect(xml).toContain(`<loc>${SITE_URL}/archive</loc>`);
		const matches = xml.match(/<url>/g) ?? [];
		expect(matches).toHaveLength(2);
	});
});
