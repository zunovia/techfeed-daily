import { describe, expect, it } from 'vitest';
import { utcDayRange } from '../src/lib/date-range.js';

describe('utcDayRange()', () => {
	it('returns the day and the next day', () => {
		expect(utcDayRange('2026-11-20')).toEqual(['2026-11-20', '2026-11-21']);
	});

	it('crosses month and year boundaries', () => {
		expect(utcDayRange('2026-11-30')).toEqual(['2026-11-30', '2026-12-01']);
		expect(utcDayRange('2026-12-31')).toEqual(['2026-12-31', '2027-01-01']);
		expect(utcDayRange('2028-02-28')).toEqual(['2028-02-28', '2028-02-29']);
	});

	it('rejects dates that do not exist (old date() query returned 0 rows for them)', () => {
		expect(utcDayRange('2026-02-30')).toBeNull();
		expect(utcDayRange('2026-13-01')).toBeNull();
		expect(utcDayRange('2026-00-10')).toBeNull();
	});

	it('rejects malformed input', () => {
		expect(utcDayRange('2026-1-5')).toBeNull();
		expect(utcDayRange("2026-11-20' OR 1=1")).toBeNull();
		expect(utcDayRange('')).toBeNull();
	});

	it('bounds match collected_at strings the same way date(collected_at) = ? did', () => {
		const [start, end] = utcDayRange('2026-11-20') as [string, string];
		const inDay = (ts: string) => ts >= start && ts < end;
		expect(inDay('2026-11-20 00:00:00')).toBe(true);
		expect(inDay('2026-11-20 23:59:59')).toBe(true);
		expect(inDay('2026-11-19 23:59:59')).toBe(false);
		expect(inDay('2026-11-21 00:00:00')).toBe(false);
	});
});
