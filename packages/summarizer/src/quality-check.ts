import type { ClaudeSummaryOutput } from '@techfeed/shared';

/**
 * Quality check result for a single summary.
 */
export interface QualityCheckResult {
	passed: boolean;
	score: number;
	failures: string[];
}

/**
 * Individual check result.
 */
interface CheckResult {
	passed: boolean;
	message: string;
}

/** Minimum summary character count */
const SUMMARY_MIN_CHARS = 350;

/** Maximum summary character count */
const SUMMARY_MAX_CHARS = 430;

/** Minimum Japanese character ratio (0-1) */
const JAPANESE_RATIO_MIN = 0.3;

/** Minimum importance score */
const IMPORTANCE_SCORE_MIN = 1;

/** Maximum importance score */
const IMPORTANCE_SCORE_MAX = 100;

/** Maximum title character count */
const TITLE_MAX_CHARS = 45;

/** Minimum quality score to pass */
export const QUALITY_PASS_THRESHOLD = 70;

/**
 * Check if a character is Japanese (Hiragana, Katakana, or CJK Unified Ideographs).
 */
function isJapaneseChar(char: string): boolean {
	const code = char.charCodeAt(0);
	// Hiragana: U+3040-U+309F
	// Katakana: U+30A0-U+30FF
	// CJK Unified Ideographs: U+4E00-U+9FFF
	return (
		(code >= 0x3040 && code <= 0x309f) ||
		(code >= 0x30a0 && code <= 0x30ff) ||
		(code >= 0x4e00 && code <= 0x9fff)
	);
}

/**
 * Calculate the ratio of Japanese characters in a string.
 */
function calcJapaneseRatio(text: string): number {
	if (text.length === 0) return 0;
	const japaneseCount = [...text].filter(isJapaneseChar).length;
	return japaneseCount / text.length;
}

/**
 * Check summary character count (350-430 chars).
 */
function checkSummaryLength(summary: string): CheckResult {
	const len = summary.length;
	if (len >= SUMMARY_MIN_CHARS && len <= SUMMARY_MAX_CHARS) {
		return { passed: true, message: `summaryJa length: ${len}字` };
	}
	return {
		passed: false,
		message: `summaryJa length ${len}字 is outside range ${SUMMARY_MIN_CHARS}-${SUMMARY_MAX_CHARS}字`,
	};
}

/**
 * Check Japanese character ratio in summary (>= 30%).
 */
function checkJapaneseRatio(summary: string): CheckResult {
	const ratio = calcJapaneseRatio(summary);
	if (ratio >= JAPANESE_RATIO_MIN) {
		return { passed: true, message: `Japanese ratio: ${(ratio * 100).toFixed(1)}%` };
	}
	return {
		passed: false,
		message: `Japanese ratio ${(ratio * 100).toFixed(1)}% is below minimum ${JAPANESE_RATIO_MIN * 100}%`,
	};
}

/**
 * Check importance score range (1-100).
 */
function checkImportanceScore(score: number): CheckResult {
	if (Number.isInteger(score) && score >= IMPORTANCE_SCORE_MIN && score <= IMPORTANCE_SCORE_MAX) {
		return { passed: true, message: `importanceScore: ${score}` };
	}
	return {
		passed: false,
		message: `importanceScore ${score} is outside range ${IMPORTANCE_SCORE_MIN}-${IMPORTANCE_SCORE_MAX}`,
	};
}

/**
 * Check title character count (<= 45 chars).
 */
function checkTitleLength(title: string): CheckResult {
	const len = title.length;
	if (len > 0 && len <= TITLE_MAX_CHARS) {
		return { passed: true, message: `titleJa length: ${len}字` };
	}
	return {
		passed: false,
		message: `titleJa length ${len}字 exceeds maximum ${TITLE_MAX_CHARS}字`,
	};
}

/**
 * Check tags array (non-empty array).
 */
function checkTags(tags: string[]): CheckResult {
	if (Array.isArray(tags) && tags.length > 0) {
		return { passed: true, message: `tags count: ${tags.length}` };
	}
	return { passed: false, message: 'tags must be a non-empty array' };
}

/**
 * Evaluate summary quality against all criteria.
 *
 * Scoring:
 * - Each check contributes 20 points if passed (5 checks total = 100 points)
 * - Pass threshold: score >= 70 (4 or more checks must pass)
 *
 * @param summary - Claude summary output to evaluate
 * @returns Quality check result with score and failure messages
 */
export function checkSummaryQuality(summary: ClaudeSummaryOutput): QualityCheckResult {
	const checks: CheckResult[] = [
		checkSummaryLength(summary.summaryJa),
		checkJapaneseRatio(summary.summaryJa),
		checkImportanceScore(summary.importanceScore),
		checkTitleLength(summary.titleJa),
		checkTags(summary.tags),
	];

	const pointsPerCheck = 20;
	const passedCount = checks.filter((c) => c.passed).length;
	const score = passedCount * pointsPerCheck;
	const failures = checks.filter((c) => !c.passed).map((c) => c.message);

	return {
		passed: score >= QUALITY_PASS_THRESHOLD,
		score,
		failures,
	};
}
