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
app.use('*', rateLimitMiddleware);

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
