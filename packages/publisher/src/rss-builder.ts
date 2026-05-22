/**
 * RSS builder — re-exported from @techfeed/shared for backwards compatibility.
 * The canonical implementation lives in packages/shared/src/builders/rss-builder.ts
 * so that both the publisher (Node.js) and the worker (Cloudflare Workers) can use it.
 */
export { buildRssXml, type RssBuildOptions } from '@techfeed/shared';
