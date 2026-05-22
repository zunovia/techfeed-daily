import type { D1ApiResponse } from '@techfeed/shared';

/**
 * Cloudflare D1 REST API client for use from GitHub Actions.
 *
 * Uses the Cloudflare REST API to execute SQL queries against D1,
 * since Workers bindings are not available outside of Workers runtime.
 *
 * @see https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
 */
export class D1RestClient {
	private readonly baseUrl: string;
	private readonly apiToken: string;

	constructor(accountId: string, databaseId: string, apiToken: string) {
		this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
		this.apiToken = apiToken;
	}

	/**
	 * Execute a SQL query against D1 via REST API.
	 *
	 * @param sql - SQL statement to execute
	 * @param params - Positional bind parameters for the query
	 * @returns D1 API response
	 */
	async execute<T = Record<string, unknown>>(
		sql: string,
		params: unknown[] = [],
	): Promise<D1ApiResponse<T>> {
		const response = await fetch(this.baseUrl, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.apiToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ sql, params }),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`D1 API error (${response.status}): ${text}`);
		}

		return (await response.json()) as D1ApiResponse<T>;
	}

	/**
	 * Execute a batch of SQL statements in a single request.
	 */
	async batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<D1ApiResponse> {
		// D1 REST API supports batch by sending multiple statements
		// We execute them sequentially to maintain order
		const results: D1ApiResponse = {
			result: [],
			success: true,
			errors: [],
			messages: [],
		};

		for (const stmt of statements) {
			const response = await this.execute(stmt.sql, stmt.params ?? []);
			if (!response.success) {
				results.success = false;
				results.errors.push(...response.errors);
			}
			results.result.push(...response.result);
		}

		return results;
	}
}
