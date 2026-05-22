import type { Context, MiddlewareHandler } from 'hono';
import type { WorkerEnv } from '../types.js';

const DEFAULT_RATE_LIMIT = 60; // req/hour for unauthenticated requests

/**
 * Current UTC hour as a zero-padded two-digit string, e.g. "09".
 */
function currentHourTag(): string {
	return new Date().getUTCHours().toString().padStart(2, '0');
}

/**
 * Compute the SHA-256 hex digest of a string.
 * Used to build a stable, non-reversible key for IP addresses.
 */
async function sha256Hex(input: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(input);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * KV-backed sliding-window rate limiter (per-hour bucket).
 *
 * Key format: rate:apikey:{key_hash}:{HH}
 * TTL: 3600s
 *
 * For unauthenticated requests, the client IP is hashed and used as the key.
 */
export const rateLimitMiddleware: MiddlewareHandler<{ Bindings: WorkerEnv }> = async (
	c: Context<{ Bindings: WorkerEnv }>,
	next,
) => {
	// Determine identity: authenticated key hash or IP hash
	const apiKeyHash = c.get('apiKeyHash' as never) as string | undefined;
	const rateLimit: number =
		(c.get('apiKeyRateLimit' as never) as number | undefined) ?? DEFAULT_RATE_LIMIT;

	let identity: string;
	if (apiKeyHash) {
		identity = apiKeyHash;
	} else {
		const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
		identity = await sha256Hex(ip);
	}

	const hour = currentHourTag();
	const kvKey = `rate:apikey:${identity}:${hour}`;

	// Read current count
	const countStr = await c.env.KV.get(kvKey);
	const count = countStr !== null ? parseInt(countStr, 10) : 0;

	if (count >= rateLimit) {
		const now = new Date();
		const retryAfter = 3600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds());
		return c.json(
			{
				error: 'Rate limit exceeded',
				retryAfter,
			},
			429,
			{
				'Retry-After': String(retryAfter),
				'X-RateLimit-Limit': String(rateLimit),
				'X-RateLimit-Remaining': '0',
				'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + retryAfter),
			},
		);
	}

	// Increment counter (fire-and-forget, do not block the response)
	const newCount = count + 1;
	c.executionCtx.waitUntil(c.env.KV.put(kvKey, String(newCount), { expirationTtl: 3600 }));

	// Add rate limit headers to response
	await next();

	c.res.headers.set('X-RateLimit-Limit', String(rateLimit));
	c.res.headers.set('X-RateLimit-Remaining', String(Math.max(0, rateLimit - newCount)));
};
