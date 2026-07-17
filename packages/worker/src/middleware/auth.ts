import type { Context, MiddlewareHandler } from 'hono';
import type { WorkerEnv } from '../types.js';

/**
 * Compute the SHA-256 hex digest of a string using the Web Crypto API.
 */
async function sha256Hex(input: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(input);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time comparison of two hex strings.
 *
 * Workers runtime does not expose crypto.timingSafeEqual, so we use
 * crypto.subtle.digest to derive equal-length byte arrays and compare.
 * Both inputs are hashed to the same fixed length before comparison.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
	// Hash both sides so we always compare 64-char hex strings
	const [hashA, hashB] = await Promise.all([sha256Hex(a), sha256Hex(b)]);

	let diff = 0;
	for (let i = 0; i < hashA.length; i++) {
		// biome-ignore lint/style/noNonNullAssertion: hashA and hashB are always 64 chars
		diff |= hashA.charCodeAt(i) ^ hashB.charCodeAt(i)!;
	}
	return diff === 0;
}

/**
 * Lookup the API key record from D1 using its SHA-256 hash.
 */
async function lookupApiKey(
	db: D1Database,
	keyHash: string,
): Promise<{ tier: string; rate_limit_per_hour: number } | null> {
	const result = await db
		.prepare(
			`SELECT tier, rate_limit_per_hour FROM api_keys
       WHERE key_hash = ? AND is_active = TRUE`,
		)
		.bind(keyHash)
		.first<{ tier: string; rate_limit_per_hour: number }>();

	return result ?? null;
}

/**
 * API Key authentication middleware.
 *
 * Public paths (defined below) are allowed through without a key.
 * All other paths require a valid X-API-Key header.
 */
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
	// The site homepage ("/") is always public.
	if (path === '/') return true;
	return PUBLIC_PATHS.some(
		(p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`),
	);
}

export const authMiddleware: MiddlewareHandler<{ Bindings: WorkerEnv }> = async (
	c: Context<{ Bindings: WorkerEnv }>,
	next,
) => {
	const path = new URL(c.req.url).pathname;

	if (isPublicPath(path)) {
		await next();
		return;
	}

	const apiKey = c.req.header('X-API-Key');
	if (!apiKey) {
		return c.json({ error: 'Missing X-API-Key header' }, 401);
	}

	const keyHash = await sha256Hex(apiKey);
	const record = await lookupApiKey(c.env.DB, keyHash);

	if (!record) {
		// Constant-time response: we still perform a timing-safe comparison
		// against a dummy to prevent timing-based key enumeration.
		await timingSafeEqual(apiKey, 'dummy_key_to_prevent_timing_attack');
		return c.json({ error: 'Invalid API key' }, 401);
	}

	// Attach key metadata to context for downstream handlers (e.g. rate limiter)
	c.set('apiKeyHash' as never, keyHash);
	c.set('apiKeyTier' as never, record.tier);
	c.set('apiKeyRateLimit' as never, record.rate_limit_per_hour);

	await next();
};
