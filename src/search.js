/**
 * `KeenableSearchProvider`: a `WebSearchProvider` for the DeepSeek Harness web
 * seam (`ctx.web`), backed by `POST /v1/search`. Keyless by default.
 * @module @keenable/dsh-keenable/search
 */

import {
  PROVIDER_ID,
  callKeenable,
  endpoint,
  isPositiveInteger,
  isValidBaseUrl,
  nonblank,
  providerError,
} from './http.js'

const LABEL = 'Keenable search'

/** The API's own bounds for `max_results` and `snippet_max_length`. */
export const MAX_RESULTS_LIMIT = 50
export const SNIPPET_CHARS_MIN = 180
export const SNIPPET_CHARS_MAX = 10_000

export class KeenableSearchProvider {
  /**
   * @param {object} options
   * @param {string} options.apiKey - API key, or `''` for the keyless endpoint.
   * @param {string} options.baseURL - API origin.
   * @param {number} options.maxSnippetChars - excerpt budget per result.
   */
  constructor(options) {
    this.id = PROVIDER_ID
    this.options = options
  }

  /** A local check only: the seam forbids network calls here. No key is needed. */
  available() {
    const { baseURL, maxSnippetChars } = this.options
    return isValidBaseUrl(baseURL)
      && Number.isInteger(maxSnippetChars)
      && maxSnippetChars >= SNIPPET_CHARS_MIN && maxSnippetChars <= SNIPPET_CHARS_MAX
  }

  /**
   * @param {{ query: string, maxResults?: number }} request
   * @param {AbortSignal} [signal]
   */
  async search(request, signal) {
    const payload = await callKeenable({
      url: endpoint(this.options.baseURL, '/v1/search', this.options.apiKey),
      method: 'POST',
      body: buildSearchBody(request, this.options),
      apiKey: this.options.apiKey,
      label: LABEL,
      signal,
    })
    try {
      return mapSearchResponse(payload, this.options)
    } catch (error) {
      throw providerError(`${LABEL} returned an unprocessable response body: ${error.message}`, error)
    }
  }
}

/**
 * The `POST /v1/search` body. `maxResults` is sent as a cost and latency
 * optimization; the seam enforces the final bound regardless.
 */
export function buildSearchBody(request, { maxSnippetChars }) {
  const body = { query: request.query, snippet_max_length: maxSnippetChars }
  if (isPositiveInteger(request.maxResults)) body.max_results = Math.min(request.maxResults, MAX_RESULTS_LIMIT)
  return body
}

/**
 * Map a search response to the seam's result. Keenable puts the page text in
 * `snippet`, with line breaks, and usually sends `description` empty, so the
 * excerpt reads `snippet` first and collapses whitespace to one line.
 * `snippet_max_length` is a hint the API may exceed slightly, so the budget is
 * enforced here as well.
 */
export function mapSearchResponse(payload, { maxSnippetChars }) {
  if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.results)) {
    throw new TypeError('response.results is not an array')
  }
  const seen = new Set()
  const sources = []
  for (const item of payload.results) {
    if (typeof item !== 'object' || item === null) continue
    const url = webUrl(item.url)
    if (url === undefined || seen.has(url)) continue
    seen.add(url)
    const title = nonblank(item.title)
    const snippet = excerpt(item, maxSnippetChars)
    const publishedAt = nonblank(item.published_at)
    sources.push({
      url,
      ...title === undefined ? {} : { title },
      ...snippet === undefined ? {} : { snippet },
      ...publishedAt === undefined ? {} : { publishedAt },
    })
  }
  return { sources, truncated: false }
}

function excerpt(item, maxChars) {
  const text = [item.snippet, item.description].map(nonblank).find(value => value !== undefined)
  if (text === undefined) return undefined
  const line = text.replace(/\s+/gu, ' ')
  return line.length > maxChars ? `${line.slice(0, maxChars - 1).trimEnd()}…` : line
}

/** An http(s) URL without embedded credentials, or `undefined`. */
function webUrl(value) {
  if (typeof value !== 'string' || !URL.canParse(value)) return undefined
  const url = new URL(value)
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return undefined
  return url.href
}
