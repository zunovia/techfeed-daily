import { Hono } from 'hono';
import type { WorkerEnv } from '../types.js';

/**
 * site.ts — Human-readable HTML front-end ("メディア本拠地").
 *
 * Renders the daily digest directly from D1/KV as a visually rich web page:
 *   - AI-generated hero image (served by /img/hero/:date, lazily cached in KV)
 *   - Auto-generated importance ranking bar chart (inline SVG, no API cost)
 *   - Tag distribution chips
 *   - Article cards with importance gauges
 *
 * This is fully self-hosted: no third-party platform, no rate limit, no manual
 * deploy step. The daily pipeline writes to D1/KV; this page reflects it instantly.
 */

const site = new Hono<{ Bindings: WorkerEnv }>();

const SITE_NAME = 'TechFeed Daily';
const SITE_TAGLINE = '海外テックニュースを毎日、日本語で。';
// 親サイト（運営元ホームページ）。各ページ上部・下部の「戻る」導線のリンク先。
const HOME_URL = 'https://surc.online/';
const HOME_LABEL = 'Sur Communication';
// 1日(=1ページ)あたりに表示する記事の上限。一覧の「件数」表示と /d/:date の取得数を
// この1か所で揃え、一覧と詳細で件数がズレないようにする。
const DAILY_LIMIT = 30;
// Cloudflare Web Analytics（cookieなし・プライバシー重視）。token はクライアント側に
// 露出する公開ビーコンID（秘密情報ではない）。全ページの </body> 直前に挿入する。
const WEB_ANALYTICS = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "6aaf33a0aaef474595bbaba144a2a3f8"}'></script>`;

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

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
}

interface SiteArticle {
	id: string;
	source: string;
	originalUrl: string;
	title: string;
	summary: string;
	score: number;
	scoreReason: string;
	tags: string[];
}

function rowToSiteArticle(row: ArticleRow): SiteArticle {
	let tags: string[] = [];
	if (row.tags) {
		try {
			const parsed = JSON.parse(row.tags) as unknown;
			tags = Array.isArray(parsed) ? (parsed as string[]).map(String) : [];
		} catch {
			tags = [];
		}
	}
	return {
		id: row.id,
		source: row.source,
		originalUrl: row.original_url,
		title: row.title_ja ?? row.title_en,
		summary: row.summary_ja ?? '',
		score: row.importance_score,
		scoreReason: row.score_reason ?? '',
		tags,
	};
}

/** Latest day's published articles (rolling 24h window, matches RSS/API). */
async function fetchLatest(db: D1Database): Promise<SiteArticle[]> {
	const { results } = await db
		.prepare(
			`SELECT id, source, original_url, title_en, title_ja, summary_ja,
              importance_score, score_reason, tags, author, published_at, collected_at
       FROM articles
       WHERE status = 'published'
         AND collected_at >= datetime('now', '-24 hours')
       ORDER BY importance_score DESC
       LIMIT ${DAILY_LIMIT}`,
		)
		.all<ArticleRow>();
	return (results ?? []).map(rowToSiteArticle);
}

/** Articles collected on a specific UTC date (archive pages). */
async function fetchByDate(db: D1Database, date: string): Promise<SiteArticle[]> {
	const { results } = await db
		.prepare(
			`SELECT id, source, original_url, title_en, title_ja, summary_ja,
              importance_score, score_reason, tags, author, published_at, collected_at
       FROM articles
       WHERE status = 'published'
         AND date(collected_at) = ?
       ORDER BY importance_score DESC
       LIMIT ${DAILY_LIMIT}`,
		)
		.bind(date)
		.all<ArticleRow>();
	return (results ?? []).map(rowToSiteArticle);
}

interface ArchiveDay {
	date: string;
	count: number;
}

/**
 * Distinct UTC dates that have published articles, newest first, with counts.
 * Grouped by date(collected_at) — the SAME bucketing used by /d/:date — so every
 * listed day is guaranteed to render a non-empty archive page.
 */
async function fetchArchiveDates(db: D1Database): Promise<ArchiveDay[]> {
	const { results } = await db
		.prepare(
			`SELECT date(collected_at) AS date, COUNT(*) AS count
       FROM articles
       WHERE status = 'published'
       GROUP BY date(collected_at)
       ORDER BY date(collected_at) DESC
       LIMIT 120`,
		)
		.all<ArchiveDay>();
	return (results ?? []).filter((r) => typeof r.date === 'string' && r.date.length === 10);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Today's date in JST (YYYY-MM-DD). */
function todayJst(): string {
	const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
	return jst.toISOString().slice(0, 10);
}

/** YYYY-MM-DD -> YYYY年M月D日（曜） */
function formatDateJa(date: string): string {
	const [y, m, d] = date.split('-').map((n) => Number.parseInt(n, 10));
	const days = ['日', '月', '火', '水', '木', '金', '土'];
	// Use UTC to avoid runtime TZ; weekday is informational.
	const wd = days[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
	return `${y}年${m}月${d}日（${wd}）`;
}

/** HTML-escape untrusted text. */
function esc(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Return an escaped href that is safe to place in an anchor.
 * Only http(s) URLs are allowed; anything else (javascript:, data:, …) → "#".
 */
function safeUrl(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return '#';
		}
		return esc(url);
	} catch {
		return '#';
	}
}

/** Clamp a score into the 0-100 range for safe chart/gauge widths. */
function clampScore(score: number): number {
	if (!Number.isFinite(score)) return 0;
	return Math.max(0, Math.min(100, score));
}

const SOURCE_LABEL: Record<string, string> = {
	hackernews: 'Hacker News',
	devto: 'DEV.to',
	github_trending: 'GitHub Trending',
};

/** Color for a score (0-100): red(low) -> amber -> green(high). */
function scoreColor(score: number): string {
	if (score >= 85) return '#ef4444'; // 最重要
	if (score >= 70) return '#f97316';
	if (score >= 50) return '#eab308';
	return '#64748b';
}

// ---------------------------------------------------------------------------
// SVG charts (generated server-side, zero API cost)
// ---------------------------------------------------------------------------

/** Horizontal bar chart of the top-N articles by importance. */
function importanceChartSvg(articles: SiteArticle[]): string {
	const top = articles.slice(0, 10);
	if (top.length === 0) return '';
	const rowH = 30;
	const gap = 8;
	const labelW = 38;
	const chartW = 320;
	const height = top.length * (rowH + gap) + gap;
	const max = 100;

	const bars = top
		.map((a, i) => {
			const y = gap + i * (rowH + gap);
			const s = clampScore(a.score);
			const w = Math.max(4, (s / max) * chartW);
			const color = scoreColor(s);
			return `
        <g>
          <rect x="${labelW}" y="${y}" width="${chartW}" height="${rowH}" rx="6" fill="#1e293b"/>
          <rect x="${labelW}" y="${y}" width="${w.toFixed(1)}" height="${rowH}" rx="6" fill="${color}"/>
          <text x="${labelW - 8}" y="${y + rowH / 2 + 5}" text-anchor="end" font-size="13" font-weight="700" fill="#e2e8f0">${i + 1}</text>
          <text x="${labelW + 10}" y="${y + rowH / 2 + 5}" font-size="13" font-weight="700" fill="#0f172a">${s}</text>
        </g>`;
		})
		.join('');

	return `<svg viewBox="0 0 ${labelW + chartW + 10} ${height}" width="100%" role="img" aria-label="重要度ランキング" style="max-width:520px">${bars}</svg>`;
}

/** Aggregate tags across articles, return top tags with counts. */
function aggregateTags(articles: SiteArticle[]): Array<{ tag: string; count: number }> {
	const counts = new Map<string, number>();
	for (const a of articles) {
		for (const t of a.tags) {
			counts.set(t, (counts.get(t) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 16);
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function renderArticleCard(a: SiteArticle, rank: number): string {
	const s = clampScore(a.score);
	const color = scoreColor(s);
	const tags = a.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('');
	const summaryHtml = esc(a.summary)
		.split(/\n+/)
		.filter((p) => p.trim().length > 0)
		.map((p) => `<p>${p}</p>`)
		.join('');
	const sourceLabel = SOURCE_LABEL[a.source] ?? a.source;
	return `
    <article class="card">
      <div class="card-head">
        <span class="rank" style="background:${color}">${rank}</span>
        <h2>${esc(a.title)}</h2>
      </div>
      <div class="gauge" title="重要度 ${s}/100">
        <div class="gauge-fill" style="width:${s}%;background:${color}"></div>
        <span class="gauge-label">重要度 ${s}<small>/100</small></span>
      </div>
      ${a.scoreReason ? `<p class="reason">💡 ${esc(a.scoreReason)}</p>` : ''}
      <div class="summary">${summaryHtml}</div>
      <div class="tags">${tags}</div>
      <div class="card-foot">
        <span class="src">${esc(sourceLabel)}</span>
        <a class="readmore" href="${safeUrl(a.originalUrl)}" target="_blank" rel="noopener noreferrer">原文を読む →</a>
      </div>
    </article>`;
}

function renderPage(date: string, articles: SiteArticle[]): string {
	const dateJa = formatDateJa(date);
	const tagStats = aggregateTags(articles);
	const avgScore =
		articles.length > 0
			? Math.round(articles.reduce((s, a) => s + a.score, 0) / articles.length)
			: 0;

	const tagChips = tagStats
		.map((t) => `<span class="tag-stat">${esc(t.tag)}<b>${t.count}</b></span>`)
		.join('');

	const cards = articles.map((a, i) => renderArticleCard(a, i + 1)).join('');

	const empty = `
    <div class="empty">
      <p>📭 本日の記事はまだ配信されていません。</p>
      <p class="muted">毎朝7時（JST）に自動更新されます。少し待ってから再読み込みしてください。</p>
    </div>`;

	const body =
		articles.length === 0
			? empty
			: `
    <section class="dashboard">
      <div class="panel">
        <h3>📊 重要度ランキング</h3>
        ${importanceChartSvg(articles)}
      </div>
      <div class="panel">
        <h3>🏷 今日のトピック</h3>
        <div class="tag-cloud">${tagChips}</div>
        <div class="stat-row">
          <div class="stat"><span class="num">${articles.length}</span><span class="lbl">記事</span></div>
          <div class="stat"><span class="num">${avgScore}</span><span class="lbl">平均重要度</span></div>
        </div>
      </div>
    </section>
    <section class="feed">${cards}</section>`;

	return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${SITE_NAME} — ${dateJa}</title>
<meta name="description" content="${SITE_TAGLINE} ${dateJa}の海外テックニュース日本語まとめ。">
<meta property="og:title" content="${SITE_NAME} — ${dateJa}">
<meta property="og:description" content="${SITE_TAGLINE}">
<meta property="og:image" content="/img/hero/${esc(date)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="application/rss+xml" title="${SITE_NAME} RSS" href="/rss">
<style>
:root{--bg:#0f172a;--panel:#1e293b;--card:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--accent:#38bdf8;--border:#334155}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif;line-height:1.7}
a{color:var(--accent);text-decoration:none}
.wrap{max-width:880px;margin:0 auto;padding:0 16px 64px}
header.hero{position:relative;overflow:hidden;background:linear-gradient(135deg,#0ea5e9,#6366f1,#a855f7)}
.hero-img{width:100%;height:240px;object-fit:cover;display:block;opacity:.55}
.hero-overlay{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:24px 16px;background:linear-gradient(to top,rgba(15,23,42,.85),transparent)}
.hero-overlay .wrap{padding-bottom:0}
.brand{font-size:14px;letter-spacing:.15em;color:#e0f2fe;font-weight:700;text-transform:uppercase}
h1{margin:4px 0 2px;font-size:28px;line-height:1.3}
.date{color:#e0f2fe;font-weight:600;font-size:15px}
.tagline{color:#bae6fd;font-size:13px;margin-top:4px}
.dashboard{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:18px}
.panel h3{margin:0 0 12px;font-size:15px;color:var(--accent)}
.tag-cloud{display:flex;flex-wrap:wrap;gap:8px}
.tag-stat{background:#0f172a;border:1px solid var(--border);border-radius:999px;padding:4px 10px;font-size:12px;color:var(--muted)}
.tag-stat b{color:var(--accent);margin-left:6px}
.stat-row{display:flex;gap:24px;margin-top:16px}
.stat{display:flex;flex-direction:column}
.stat .num{font-size:28px;font-weight:800;color:var(--text)}
.stat .lbl{font-size:12px;color:var(--muted)}
.feed{display:flex;flex-direction:column;gap:18px}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px;transition:border-color .2s}
.card:hover{border-color:var(--accent)}
.card-head{display:flex;gap:12px;align-items:flex-start}
.rank{flex:0 0 auto;width:30px;height:30px;border-radius:8px;color:#0f172a;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:15px}
.card-head h2{margin:0;font-size:19px;line-height:1.4}
.gauge{position:relative;height:22px;background:#0f172a;border-radius:6px;margin:12px 0;overflow:hidden}
.gauge-fill{height:100%;border-radius:6px}
.gauge-label{position:absolute;top:0;right:8px;line-height:22px;font-size:12px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.6)}
.gauge-label small{opacity:.7}
.reason{color:var(--muted);font-size:13px;margin:4px 0 8px}
.summary p{margin:8px 0;font-size:15px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}
.tag{background:#0f172a;border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:12px;color:var(--accent)}
.card-foot{display:flex;justify-content:space-between;align-items:center;margin-top:8px;border-top:1px solid var(--border);padding-top:12px}
.src{font-size:12px;color:var(--muted)}
.readmore{font-weight:700;font-size:14px}
.empty{text-align:center;padding:64px 16px}
.muted{color:var(--muted);font-size:14px}
footer{text-align:center;color:var(--muted);font-size:12px;padding:32px 16px;border-top:1px solid var(--border);margin-top:32px}
footer a{color:var(--muted)}
.topbar{position:sticky;top:0;z-index:50;background:rgba(15,23,42,.92);backdrop-filter:blur(6px);border-bottom:1px solid var(--border);padding:10px 16px}
.topbar .wrap{padding:0;display:flex;align-items:center}
.topbar a{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--accent)}
.backbtn{display:inline-flex;align-items:center;gap:8px;margin:24px 0 0;padding:10px 16px;background:var(--panel);border:1px solid var(--border);border-radius:999px;font-weight:700;font-size:14px;color:var(--accent)}
.backbtn:hover{border-color:var(--accent)}
.backbar{text-align:center;padding:8px 16px 0}
@media(max-width:640px){.dashboard{grid-template-columns:1fr}h1{font-size:22px}.hero-img{height:180px}}
</style>
</head>
<body>
<div class="topbar">
  <div class="wrap">
    <a href="${HOME_URL}">← ${HOME_LABEL}（ホーム）に戻る</a>
    <a href="/archive" style="margin-left:auto">📚 アーカイブ</a>
  </div>
</div>
<header class="hero">
  <img class="hero-img" src="/img/hero/${esc(date)}" alt="" loading="eager" onerror="this.style.display='none'">
  <div class="hero-overlay">
    <div class="wrap">
      <div class="brand">${SITE_NAME}</div>
      <h1>海外テックニュース 日本語まとめ</h1>
      <div class="date">${dateJa}</div>
      <div class="tagline">${SITE_TAGLINE}</div>
    </div>
  </div>
</header>
<main class="wrap">
  ${body}
  <div class="backbar">
    <a class="backbtn" href="${HOME_URL}">← ${HOME_LABEL}（ホームページ）に戻る</a>
  </div>
</main>
<footer>
  <p>${SITE_NAME} — 毎朝7時(JST)に自動更新 / <a href="/archive">📚 アーカイブ</a> ・ <a href="/rss">RSS</a> ・ <a href="/api/articles">API</a></p>
  <p>本サイトはAIにより自動収集・要約・配信されています。</p>
</footer>
${WEB_ANALYTICS}
</body>
</html>`;
}

/** Archive index — lists every day that has articles, linking to /d/:date. */
function renderArchivePage(dates: ArchiveDay[]): string {
	const totalDays = dates.length;
	// Cap each day's count to DAILY_LIMIT so the listed number matches what the
	// /d/:date page actually renders (which is limited to DAILY_LIMIT articles).
	const shown = (n: number) => Math.min(n, DAILY_LIMIT);
	const totalArticles = dates.reduce((s, d) => s + shown(d.count), 0);

	const items = dates
		.map(
			(d) => `
      <a class="arch-item" href="/d/${esc(d.date)}">
        <span class="arch-date">${esc(formatDateJa(d.date))}</span>
        <span class="arch-count">${shown(d.count)}<small>件</small></span>
      </a>`,
		)
		.join('');

	const body =
		totalDays === 0
			? `<div class="empty"><p>📭 まだアーカイブがありません。</p>
         <p class="muted">毎朝7時（JST）に最初の記事が配信されると、ここに日別の一覧が並びます。</p></div>`
			: `<section class="arch-grid">${items}</section>`;

	return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${SITE_NAME} — アーカイブ</title>
<meta name="description" content="${SITE_TAGLINE} 過去の海外テックニュース日本語まとめを日付別に一覧できます。">
<meta property="og:title" content="${SITE_NAME} — アーカイブ">
<meta property="og:description" content="${SITE_TAGLINE}">
<meta property="og:type" content="website">
<link rel="alternate" type="application/rss+xml" title="${SITE_NAME} RSS" href="/rss">
<style>
:root{--bg:#0f172a;--panel:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--accent:#38bdf8;--border:#334155}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif;line-height:1.7}
a{color:var(--accent);text-decoration:none}
.wrap{max-width:880px;margin:0 auto;padding:0 16px 64px}
.topbar{position:sticky;top:0;z-index:50;background:rgba(15,23,42,.92);backdrop-filter:blur(6px);border-bottom:1px solid var(--border);padding:10px 16px}
.topbar .wrap{padding:0;display:flex;align-items:center}
.topbar a{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--accent)}
header.hero{background:linear-gradient(135deg,#0ea5e9,#6366f1,#a855f7);padding:32px 16px}
header.hero .wrap{padding-bottom:0}
.brand{font-size:14px;letter-spacing:.15em;color:#e0f2fe;font-weight:700;text-transform:uppercase}
h1{margin:6px 0 4px;font-size:26px;line-height:1.3}
.tagline{color:#bae6fd;font-size:13px}
.summary-line{color:var(--muted);font-size:13px;margin:20px 0 8px}
.arch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:12px}
.arch-item{display:flex;justify-content:space-between;align-items:center;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px 16px;transition:border-color .2s,transform .1s}
.arch-item:hover{border-color:var(--accent);transform:translateY(-1px)}
.arch-date{font-weight:700;font-size:15px;color:var(--text)}
.arch-count{font-weight:800;font-size:18px;color:var(--accent)}
.arch-count small{font-size:11px;color:var(--muted);margin-left:2px;font-weight:600}
.empty{text-align:center;padding:64px 16px}
.muted{color:var(--muted);font-size:14px}
.backbtn{display:inline-flex;align-items:center;gap:8px;margin:24px 0 0;padding:10px 16px;background:var(--panel);border:1px solid var(--border);border-radius:999px;font-weight:700;font-size:14px;color:var(--accent)}
.backbtn:hover{border-color:var(--accent)}
footer{text-align:center;color:var(--muted);font-size:12px;padding:32px 16px;border-top:1px solid var(--border);margin-top:32px}
footer a{color:var(--muted)}
@media(max-width:640px){h1{font-size:22px}}
</style>
</head>
<body>
<div class="topbar">
  <div class="wrap">
    <a href="/">← 最新のまとめに戻る</a>
    <a href="${HOME_URL}" style="margin-left:auto">${HOME_LABEL}（ホーム）</a>
  </div>
</div>
<header class="hero">
  <div class="wrap">
    <div class="brand">${SITE_NAME}</div>
    <h1>📚 日次アーカイブ</h1>
    <div class="tagline">${SITE_TAGLINE}</div>
  </div>
</header>
<main class="wrap">
  ${totalDays > 0 ? `<p class="summary-line">${totalDays}日分・累計${totalArticles}記事を配信。日付をタップするとその日のまとめを表示します。</p>` : ''}
  ${body}
  <div style="text-align:center">
    <a class="backbtn" href="/">← 最新のまとめへ</a>
  </div>
</main>
<footer>
  <p>${SITE_NAME} — 毎朝7時(JST)に自動更新 / <a href="/">最新</a> ・ <a href="/rss">RSS</a> ・ <a href="/api/articles">API</a></p>
  <p>本サイトはAIにより自動収集・要約・配信されています。</p>
</footer>
${WEB_ANALYTICS}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** GET / — latest daily digest. */
site.get('/', async (c) => {
	try {
		const articles = await fetchLatest(c.env.DB);
		const date = todayJst();
		return c.html(renderPage(date, articles));
	} catch (err) {
		console.error('[site] failed to render home:', err);
		return c.html(renderPage(todayJst(), []), 200);
	}
});

/** GET /archive — index of all days that have articles. */
site.get('/archive', async (c) => {
	try {
		const dates = await fetchArchiveDates(c.env.DB);
		return c.html(renderArchivePage(dates));
	} catch (err) {
		console.error('[site] failed to render archive:', err);
		return c.html(renderArchivePage([]), 200);
	}
});

/** GET /d/:date — archive page for a specific date (YYYY-MM-DD). */
site.get('/d/:date', async (c) => {
	const date = c.req.param('date');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		return c.html('<p>日付の形式が正しくありません（YYYY-MM-DD）。</p>', 400);
	}
	try {
		const articles = await fetchByDate(c.env.DB, date);
		return c.html(renderPage(date, articles));
	} catch (err) {
		console.error(`[site] failed to render date=${date}:`, err);
		return c.html(renderPage(date, []), 200);
	}
});

export { site };
