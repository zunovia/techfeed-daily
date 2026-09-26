import { Hono } from 'hono';
import { authMiddleware } from './middleware/auth.js';
import { corsMiddleware } from './middleware/cors.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { articles } from './routes/articles.js';
import { health } from './routes/health.js';
import { image } from './routes/image.js';
import { rss } from './routes/rss.js';
import { site } from './routes/site.js';
import type { WorkerEnv } from './types.js';

const app = new Hono<{ Bindings: WorkerEnv }>();

// Global middleware
app.use('*', corsMiddleware);
app.use('*', authMiddleware);
// レート制限は API だけに掛ける。
// 以前は '*' で、HTML・RSS・画像・クローラーを含む全アクセスが KV に 1 書き込みしていた。
// 無料枠の書き込みは 1,000/日なので 500 アクセスで警告が来る（2026-09-27 に到達）。
// サイト本体は Cloudflare のエッジが前段にあり、KV で数える意味がない。
app.use('/api/*', rateLimitMiddleware);

// RSS と API は検索結果に載せない。XML/JSON なので載る性質のものではなく、
// 放置すると Search Console に「クロール済み・インデックス未登録」として残り続ける。
const noindex = async (c: { header: (k: string, v: string) => void }, next: () => Promise<void>) => {
	await next();
	c.header('X-Robots-Tag', 'noindex');
};
app.use('/rss', noindex);
app.use('/rss/*', noindex);
app.use('/api/*', noindex);

// Routes
app.route('/rss', rss);
app.route('/api/articles', articles);
app.route('/api/health', health);
app.route('/img', image);
// Human-readable site (mounted last; owns "/" and "/d/:date")
app.route('/', site);

// 404 fallback
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler
app.onError((err, c) => {
	console.error('[worker] Unhandled error:', err);
	return c.json({ error: 'Internal server error' }, 500);
});

export default app;
