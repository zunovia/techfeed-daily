/**
 * Returns the current UTC datetime as ISO 8601 string (without milliseconds).
 * Format: YYYY-MM-DDTHH:MM:SSZ
 */
export function nowISO(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Returns today's date in YYYY-MM-DD format (UTC).
 */
export function todayUTC(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Converts a Unix timestamp (seconds) to ISO 8601 string.
 */
export function unixToISO(timestamp: number): string {
	return new Date(timestamp * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Checks if the given ISO date string is within the last N hours.
 */
export function isWithinHours(isoDate: string, hours: number): boolean {
	const date = new Date(isoDate);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	return diffMs <= hours * 60 * 60 * 1000;
}

/**
 * Formats a Date or ISO string to SQLite-compatible datetime string.
 * Format: YYYY-MM-DD HH:MM:SS
 */
export function toSQLiteDatetime(input: Date | string): string {
	const date = typeof input === 'string' ? new Date(input) : input;
	return date
		.toISOString()
		.replace('T', ' ')
		.replace(/\.\d{3}Z$/, '');
}
