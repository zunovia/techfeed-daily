import type { MiddlewareHandler } from 'hono';
import type { WorkerEnv } from '../types.js';

/**
 * CORS middleware.
 *
 * Public endpoints (/rss, /api/articles, /api/health) are accessible from any
 * origin. Authenticated endpoints (/api/v1/*) are restricted to the same
 * allowed origins list.
 */
export const corsMiddleware: MiddlewareHandler<{ Bindings: WorkerEnv }> = async (c, next) => {
	await next();

	c.res.headers.set('Access-Control-Allow-Origin', '*');
	c.res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
	c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
	c.res.headers.set('Access-Control-Max-Age', '86400');
};
