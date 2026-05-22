/**
 * Cloudflare Workers environment bindings for TechFeed Daily Worker.
 *
 * WorkerEnv is defined here (not in @techfeed/shared) because it references
 * Cloudflare-specific types (D1Database, KVNamespace) that are only available
 * via @cloudflare/workers-types.
 */
export interface WorkerEnv {
	DB: D1Database;
	KV: KVNamespace;
	ENVIRONMENT: 'production' | 'staging';
}
