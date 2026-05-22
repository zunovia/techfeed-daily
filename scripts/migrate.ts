/**
 * scripts/migrate.ts
 *
 * Applies SQL migration files from the `migrations/` directory to Cloudflare D1
 * via the REST API.
 *
 * Usage:
 *   # Apply a specific migration file
 *   npx tsx scripts/migrate.ts migrations/0001_initial.sql
 *
 *   # Apply all migration files in order
 *   npx tsx scripts/migrate.ts
 *
 * Required environment variables:
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_API_TOKEN
 *   D1_DATABASE_ID
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
): Promise<D1ApiResponse> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ sql }),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`D1 API error (${response.status}): ${text}`);
	}

	return (await response.json()) as D1ApiResponse;
}

async function applyMigration(
	accountId: string,
	databaseId: string,
	apiToken: string,
	filePath: string,
): Promise<void> {
	console.log(`Applying migration: ${filePath}`);
	const sql = await readFile(filePath, 'utf-8');

	if (!sql.trim()) {
		console.log(`  Skipped (empty file).`);
		return;
	}

	const result = await queryD1(accountId, databaseId, apiToken, sql);

	if (!result.success) {
		throw new Error(
			`Migration failed for ${filePath}:\n${result.errors.map((e) => `  [${e.code}] ${e.message}`).join('\n')}`,
		);
	}

	console.log(`  Done.`);
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

	const [, , targetFile] = process.argv;

	if (targetFile) {
		// Apply a single specified migration file
		const filePath = resolve(targetFile);
		await applyMigration(accountId, databaseId, apiToken, filePath);
	} else {
		// Apply all .sql files in migrations/ directory, sorted by name
		const migrationsDir = resolve('migrations');
		const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

		if (files.length === 0) {
			console.log('No migration files found in migrations/.');
			return;
		}

		console.log(`Found ${files.length} migration file(s).`);

		for (const file of files) {
			const filePath = resolve(migrationsDir, file);
			await applyMigration(accountId, databaseId, apiToken, filePath);
		}
	}

	console.log('Migration complete.');
}

main().catch((err: unknown) => {
	console.error('Unexpected error:', err);
	process.exit(1);
});
