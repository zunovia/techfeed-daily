import { Hono } from 'hono';
import type { WorkerEnv } from '../types.js';

/**
 * image.ts — AI-generated hero image, served and cached entirely within
 * Cloudflare (Workers AI + KV). No third-party image API, no extra key.
 *
 * GET /img/hero/:date
 *   1. Serve from KV cache if present (key: img:hero:<date>).
 *   2. Otherwise generate a thematic illustration from the day's top tags via
 *      Workers AI (flux-1-schnell), cache it in KV, and serve it.
 *
 * The image is generated lazily on first view, so it costs nothing on days
 * nobody visits and is free-tier friendly (1 small image / day).
 */

const image = new Hono<{ Bindings: WorkerEnv }>();

const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const KV_PREFIX = 'img:hero:';
// Cache successful images effectively forever; the date in the key makes each
// day unique. (Generation only happens for real article-days, so the number of
// distinct keys is bounded by the number of days the service has run.)
const THEMED_TTL = 60 * 60 * 24 * 90; // 90 days
// Earliest date we will generate an image for (service launch). Blocks abuse
// via requests for arbitrary far-past dates.
const MIN_DATE = '2026-05-01';

/** Fetch the day's top tags to theme the illustration. */
async function fetchThemeTags(db: D1Database, date: string): Promise<string[]> {
	const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
	const isToday = date === todayJst;
	const where = isToday ? "collected_at >= datetime('now', '-24 hours')" : 'date(collected_at) = ?';
	const stmt = db.prepare(
		`SELECT tags FROM articles
     WHERE status = 'published' AND ${where}
     ORDER BY importance_score DESC LIMIT 8`,
	);
	const bound = isToday ? stmt : stmt.bind(date);
	const { results } = await bound.all<{ tags: string | null }>();

	const counts = new Map<string, number>();
	for (const row of results ?? []) {
		if (!row.tags) continue;
		try {
			const parsed = JSON.parse(row.tags) as unknown;
			if (!Array.isArray(parsed)) continue;
			for (const t of parsed as string[]) {
				counts.set(String(t), (counts.get(String(t)) ?? 0) + 1);
			}
		} catch {
			// ignore malformed tags
		}
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 4)
		.map(([t]) => t);
}

function buildPrompt(tags: string[]): string {
	const theme =
		tags.length > 0 ? tags.join(', ') : 'technology, software, artificial intelligence, innovation';
	return (
		`Modern editorial illustration for a technology news digest. ` +
		`Theme: ${theme}. ` +
		`Flat vector style, vibrant blue and purple gradient palette, clean geometric shapes, ` +
		`abstract tech motifs (circuits, networks, screens), soft lighting, high quality, ` +
		`wide banner composition. No text, no letters, no words, no watermark.`
	);
}

/** Decode a base64 string into a Uint8Array (Workers-safe). */
function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) {
		bytes[i] = bin.charCodeAt(i);
	}
	return bytes;
}

image.get('/hero/:date', async (c) => {
	const date = c.req.param('date');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		return c.json({ error: 'Invalid date' }, 400);
	}

	const kvKey = `${KV_PREFIX}${date}`;

	// 1. Serve from cache.
	// (To regenerate an image, delete its KV key — there is intentionally no
	// public ?refresh bypass, so the costly AI path cannot be triggered on demand.)
	const cached = await c.env.KV.get(kvKey, 'arrayBuffer');
	if (cached) {
		return c.body(cached, 200, {
			'Content-Type': 'image/jpeg',
			'Cache-Control': 'public, max-age=86400',
		});
	}

	// 2. Bound the date range so arbitrary far-past/future dates can't be used to
	// trigger unlimited AI generations (DoS / quota exhaustion).
	const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
	if (date < MIN_DATE || date > todayJst) {
		return c.json({ error: 'No image for this date' }, 404);
	}

	if (!c.env.AI) {
		return c.json({ error: 'Image generation unavailable' }, 503);
	}

	try {
		// Only generate for days that actually have published articles. A day with
		// no content returns 404 (the site's <img onerror> hides it gracefully),
		// which prevents generating placeholder images for empty dates.
		const tags = await fetchThemeTags(c.env.DB, date);
		if (tags.length === 0) {
			return c.json({ error: 'No content for this date' }, 404);
		}

		const prompt = buildPrompt(tags);
		const result = (await c.env.AI.run(MODEL, { prompt, steps: 4 })) as { image?: string };
		if (!result?.image) {
			return c.json({ error: 'Generation failed' }, 502);
		}

		const bytes = base64ToBytes(result.image);
		await c.env.KV.put(kvKey, bytes, { expirationTtl: THEMED_TTL });

		return c.body(bytes, 200, {
			'Content-Type': 'image/jpeg',
			'Cache-Control': 'public, max-age=86400',
		});
	} catch (err) {
		console.error(`[image] generation failed for ${date}:`, err);
		return c.json({ error: 'Image generation error' }, 500);
	}
});

export { image };
