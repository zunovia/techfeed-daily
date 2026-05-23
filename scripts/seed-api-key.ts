/**
 * scripts/seed-api-key.ts
 *
 * Seeds the public API key for Phase 1 into the D1 api_keys table.
 *
 * The key `tf_live_public00000000000000000000000000000` is SHA-256 hashed
 * and inserted with tier='free' and rate_limit_per_hour=60.
 *
 * Usage:
 *   npx tsx scripts/seed-api-key.ts
 *
 * Required environment variables:
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_API_TOKEN
 *   D1_DATABASE_ID
 */

import { createHash } from 'node:crypto';

const PUBLIC_API_KEY = 'tf_live_public00000000000000000000000000000';

interface D1ApiResponse {
	success: boolean;
	errors: Array<{ code: number; message: string }>;
	messages: string[];
	result: unknown[];
}

async function queryD1(
	accountId: string,
	databaseId: string,
	apiToken: string,
	sql: string,
	params: unknown[] = [],
): Promise<D1ApiResponse> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ sql, params }),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`D1 API error (${response.status}): ${text}`);
	}

	return (await response.json()) as D1ApiResponse;
}

async function main(): Promise<void> {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
	const apiToken = process.env.CLOUDFLARE_API_TOKEN;
	const databaseId = process.env.D1_DATABASE_ID;

	if (!accountId || !apiToken || !databaseId) {
		console.error('Error: Missing required environment variables.');
		console.error('  CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID');
		process.exit(1);
	}

	const keyHash = createHash('sha256').update(PUBLIC_API_KEY).digest('hex');

	// Mask the key in logs: show only the first 8 characters followed by asterisks
	const maskedKey = `${PUBLIC_API_KEY.slice(0, 8)}${'*'.repeat(PUBLIC_API_KEY.length - 8)}`;
	console.log(`Seeding public API key...`);
	console.log(`  Key:  ${maskedKey}`);
	console.log(`  Hash: ${keyHash}`);

	const sql = `
		INSERT INTO api_keys (key_hash, name, tier, rate_limit_per_hour, is_active)
		VALUES (?, ?, 'free', 60, TRUE)
		ON CONFLICT (key_hash) DO UPDATE SET
			name = excluded.name,
			tier = excluded.tier,
			rate_limit_per_hour = excluded.rate_limit_per_hour,
			is_active = excluded.is_active
	`;

	const result = await queryD1(accountId, databaseId, apiToken, sql, [
		keyHash,
		'Public Phase 1 Key',
	]);

	if (!result.success) {
		console.error('Failed to seed API key:', result.errors);
		process.exit(1);
	}

	console.log('API key seeded successfully.');
}

main().catch((err: unknown) => {
	console.error('Unexpected error:', err);
	process.exit(1);
});
