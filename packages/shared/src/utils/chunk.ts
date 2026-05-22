/**
 * Splits an array into chunks of the specified size.
 * Useful for batching API calls (e.g., Claude Batch API with 20-item batches).
 */
export function chunk<T>(array: T[], size: number): T[][] {
	if (size <= 0) {
		throw new Error(`Chunk size must be positive, got ${size}`);
	}
	const result: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		result.push(array.slice(i, i + size));
	}
	return result;
}
