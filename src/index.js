/**
 * `@keenable/dsh-keenable`: registers Keenable search and fetch providers with
 * the DeepSeek Harness web seam (`ctx.web`), so the built-in `web_search` and
 * `web_fetch` tools answer through Keenable. Both work without an API key; a
 * key only lifts the per-IP rate limit of the keyless endpoints.
 *
 * A function plugin, not a service: it registers into the registries that
 * `@deepseek-ai/dsh-web` owns. The bundle patch pins both provider ids.
 * @module @keenable/dsh-keenable
 */

import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_BASE_URL, nonblank } from './http.js'
import { KeenableFetchProvider } from './fetch.js'
import { KeenableSearchProvider, SNIPPET_CHARS_MAX, SNIPPET_CHARS_MIN } from './search.js'

export { APP_TITLE, DEFAULT_BASE_URL, PROVIDER_ID, VERSION } from './http.js'
export { KeenableSearchProvider, buildSearchBody, mapSearchResponse } from './search.js'
export { KeenableFetchProvider, assertFetchableUrl, buildFetchQuery, mapFetchResponse } from './fetch.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'keenable'

/** The web seam both providers register into. */
export const inject = ['web']

/** Same cap as the local HTTP fetch provider, below the tool's own output cap. */
export const DEFAULT_MAX_BODY_CHARS = 100_000

export const Config = z.object({
  apiKey: z.string().role('secret')
    .description('Optional Keenable API key. Without one, search and fetch use the keyless endpoints, limited to 10 requests per second and 1,000 per hour per IP address. Falls back to $KEENABLE_API_KEY.'),
  baseURL: z.string().default(DEFAULT_BASE_URL)
    .description('Keenable API origin. HTTPS only.'),
  maxSnippetChars: z.number().step(1).min(SNIPPET_CHARS_MIN).max(SNIPPET_CHARS_MAX).default(500)
    .description('Excerpt length per search result, in characters.'),
  fetchLive: z.boolean().default(true)
    .description('Fetch pages live from the source. When off, web_fetch returns Keenable\'s indexed copy and fails for pages it has not indexed.'),
  maxBodyChars: z.number().step(1).min(1).max(DEFAULT_MAX_BODY_CHARS * 2 - 1).default(DEFAULT_MAX_BODY_CHARS)
    .description('Maximum characters of page text web_fetch returns.'),
})

/** Register both providers. Cordis disposes the registrations with the plugin. */
export function apply(ctx, config) {
  const apiKey = nonblank(config.apiKey)
    ?? nonblank(launchEnvironmentOf(ctx).get('KEENABLE_API_KEY')?.value)
    ?? ''
  ctx.web.registerSearchProvider(new KeenableSearchProvider({
    apiKey,
    baseURL: config.baseURL,
    maxSnippetChars: config.maxSnippetChars,
  }))
  ctx.web.registerFetchProvider(new KeenableFetchProvider({
    apiKey,
    baseURL: config.baseURL,
    live: config.fetchLive,
    maxBodyChars: config.maxBodyChars,
    maxUrlLength: 2048,
  }))
}
