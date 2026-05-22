/**
 * Cloudflare KV REST API client for use from GitHub Actions (Node.js).
 *
 * @see https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/subresources/values/methods/update/
 */
export class KvRestClient {
	private readonly baseUrl: string;
	private readonly apiToken: string;

	constructor(accountId: string, namespaceId: string, apiToken: string) {
		this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values`;
		this.apiToken = apiToken;
	}

	/**
	 * Write a value to Cloudflare KV.
	 *
	 * @param key - KV key
	 * @param value - String value to store
	 * @param ttlSeconds - Optional TTL in seconds. If omitted the value never expires.
	 */
	async put(key: string, value: string, ttlSeconds?: number): Promise<void> {
		const url = new URL(`${this.baseUrl}/${encodeURIComponent(key)}`);
		if (ttlSeconds !== undefined) {
			url.searchParams.set('expiration_ttl', String(ttlSeconds));
		}

		const response = await fetch(url.toString(), {
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${this.apiToken}`,
				'Content-Type': 'text/plain',
			},
			body: value,
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`KV PUT error (${response.status}) key=${key}: ${text}`);
		}
	}

	/**
	 * Read a value from Cloudflare KV.
	 *
	 * @param key - KV key
	 * @returns The stored string, or null if the key does not exist.
	 */
	async get(key: string): Promise<string | null> {
		const url = `${this.baseUrl}/${encodeURIComponent(key)}`;

		const response = await fetch(url, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${this.apiToken}`,
			},
		});

		if (response.status === 404) {
			return null;
		}

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`KV GET error (${response.status}) key=${key}: ${text}`);
		}

		return await response.text();
	}
}
