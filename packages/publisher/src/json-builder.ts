/**
 * JSON builder — re-exported from @techfeed/shared for backwards compatibility.
 * The canonical implementation lives in packages/shared/src/builders/json-builder.ts
 * so that both the publisher (Node.js) and the worker (Cloudflare Workers) can use it.
 */
export { buildJsonResponse, type JsonBuildOptions } from '@techfeed/shared';
