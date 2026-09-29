/**
 * `KeenableFetchProvider`: a `WebFetchProvider` for the DeepSeek Harness web
 * seam (`ctx.web`), backed by `GET /v1/fetch`. The page is retrieved on
 * Keenable's servers and returned as markdown, so the model-chosen URL is never
 * requested from the machine running Harness. Keyless by default.
 * @module @keenable/dsh-keenable/fetch
 */

import { WebError } from '@deepseek-ai/dsh-web'
import {
  PROVIDER_ID,
  callKeenable,
  endpoint,
  isPositiveInteger,
  isValidBaseUrl,
  nonblank,
  providerError,
} from './http.js'

const LABEL = 'Keenable fetch'

/** Largest `max_chars` the API accepts, and so the largest body this provider asks for. */
export const MAX_BODY_CHARS_LIMIT = 200_000

export class KeenableFetchProvider {
  /**
   * @param {object} options
   * @param {string} options.apiKey - API key, or `''` for the keyless endpoint.
   * @param {string} options.baseURL - API origin.
   * @param {boolean} options.live - fetch from the source instead of the index.
   * @param {number} options.maxBodyChars - cap on returned characters.
   * @param {number} options.maxUrlLength - longest accepted request URL.
   */
  constructor(options) {
    this.id = PROVIDER_ID
    this.options = options
  }

  /** A local check only: the seam forbids network calls here. No key is needed. */
  available() {
    const { baseURL, maxBodyChars, maxUrlLength } = this.options
    return isValidBaseUrl(baseURL)
      && isPositiveInteger(maxBodyChars) && maxBodyChars < MAX_BODY_CHARS_LIMIT
      && isPositiveInteger(maxUrlLength)
  }

  /**
   * @param {{ url: string }} request
   * @param {AbortSignal} [signal]
   */
  async fetch(request, signal) {
    // Reject locally, before anything is sent: a file:// or credential-carrying
    // URL must never reach the API.
    assertFetchableUrl(request.url, this.options.maxUrlLength)
    const payload = await callKeenable({
      url: `${endpoint(this.options.baseURL, '/v1/fetch', this.options.apiKey)}?${buildFetchQuery(request, this.options)}`,
      method: 'GET',
      apiKey: this.options.apiKey,
      label: LABEL,
      signal,
    })
    try {
      return mapFetchResponse(payload, request.url, this.options)
    } catch (error) {
      throw providerError(`${LABEL} returned an unprocessable response body: ${error.message}`, error)
    }
  }
}

/**
 * Validate a fetch target, throwing `WEB_INVALID_URL` (the local HTTP
 * provider's code) when it must not be requested.
 */
export function assertFetchableUrl(url, maxUrlLength) {
  if (typeof url !== 'string' || url.length > maxUrlLength) {
    throw new WebError(`URL exceeds the ${maxUrlLength}-character limit`, 'WEB_INVALID_URL')
  }
  if (!URL.canParse(url)) throw new WebError(`invalid URL: ${url}`, 'WEB_INVALID_URL')
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${parsed.protocol}"; only http and https are fetchable`, 'WEB_INVALID_URL')
  }
  if (parsed.username || parsed.password) {
    throw new WebError('URL must not carry embedded credentials', 'WEB_INVALID_URL')
  }
}

/**
 * The `GET /v1/fetch` query. One character more than the budget is requested,
 * so a page longer than the budget is detected and flagged as truncated.
 */
export function buildFetchQuery(request, { live, maxBodyChars }) {
  const query = new URLSearchParams({ url: request.url, max_chars: String(maxBodyChars + 1) })
  if (live) query.set('live', 'true')
  return query.toString()
}

/**
 * Map a fetch response to the seam's result. The body is markdown, the seam's
 * `text` kind. Keenable returns the page title as a separate field, often
 * absent from `content`, so it is prepended as a heading when the text does
 * not already open with it. Keenable reports failures as HTTP errors and
 * returns no status code of the page on success, so success is reported as 200.
 */
export function mapFetchResponse(payload, requestedUrl, { maxBodyChars }) {
  if (typeof payload !== 'object' || payload === null || typeof payload.content !== 'string') {
    throw new TypeError('response.content is not a string')
  }
  const title = nonblank(payload.title)
  const content = title !== undefined && !payload.content.slice(0, 300).includes(title)
    ? `# ${title}\n\n${payload.content}`
    : payload.content
  const truncated = content.length > maxBodyChars
  return {
    url: nonblank(payload.url) ?? requestedUrl,
    statusCode: 200,
    body: { kind: 'text', content: truncated ? content.slice(0, maxBodyChars) : content },
    truncated,
  }
}
