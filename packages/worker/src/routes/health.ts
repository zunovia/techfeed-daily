import { Hono } from 'hono';
import type { WorkerEnv } from '../types.js';

const health = new Hono<{ Bindings: WorkerEnv }>();

/**
 * GET /api/health
 *
 * Returns KV and D1 connectivity status plus the last pipeline execution info.
 */
health.get('/', async (c) => {
	const checks: {
		kv: 'ok' | 'error';
		d1: 'ok' | 'error';
		kvError?: string;
		d1Error?: string;
	} = { kv: 'ok', d1: 'ok' };

	// KV health check
	try {
		await c.env.KV.get('meta:last_updated');
	} catch (err) {
		checks.kv = 'error';
		checks.kvError = err instanceof Error ? err.message : String(err);
	}

	// D1 health check
	let lastUpdated: string | null = null;
	let articleCount = 0;

	try {
		const row = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM articles').first<{
			cnt: number;
		}>();
		articleCount = row?.cnt ?? 0;
	} catch (err) {
		checks.d1 = 'error';
		checks.d1Error = err instanceof Error ? err.message : String(err);
	}

	// Last pipeline execution info from KV
	try {
		lastUpdated = await c.env.KV.get('meta:last_updated');
	} catch {
		// Non-fatal — we already captured the KV error above
	}

	const healthy = checks.kv === 'ok' && checks.d1 === 'ok';
	const status = healthy ? 200 : 503;

	return c.json(
		{
			status: healthy ? 'ok' : 'degraded',
			checks: {
				kv: checks.kv,
				d1: checks.d1,
				...(checks.kvError ? { kvError: checks.kvError } : {}),
				...(checks.d1Error ? { d1Error: checks.d1Error } : {}),
			},
			pipeline: {
				lastUpdated,
				articleCount,
			},
			timestamp: new Date().toISOString(),
		},
		status,
	);
});

export { health };
