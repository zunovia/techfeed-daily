import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Worker tests are validated at type-check level.
		// miniflare integration tests are out of scope for Phase 1c.
		passWithNoTests: true,
	},
});
