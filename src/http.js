/**
 * Shared transport for the Keenable search and fetch providers: one request
 * helper and one error vocabulary, so the redirect policy, the attribution
 * headers and the abort/error classification cannot drift between the two.
 * @module @keenable/dsh-keenable/http
 */

import { WebError } from '@deepseek-ai/dsh-web'

/** The id both providers register under, one per capability registry. */
export const PROVIDER_ID = 'keenable'

/** Default API origin; the versioned path is appended per operation. */
export const DEFAULT_BASE_URL = 'https://api.keenable.ai'

/** Package version, sent in the user agent. Bump with package.json. */
export const VERSION = '0.1.0'

/**
 * Application name sent as `X-Keenable-Title`. The keyless endpoints reject a
 * request without it (400 "Missing app identifier"), and it attributes traffic.
 */
export const APP_TITLE = 'dsh-keenable'

const USER_AGENT = `@keenable/dsh-keenable/${VERSION} (+https://github.com/keenableai/dsh-keenable)`

/**
 * The endpoint for one operation. Without a key the request goes to the
 * keyless `/public` variant, which takes the same parameters and returns the
 * same shape but is rate limited per IP.
 *
 * @param {string} baseURL - the configured API origin.
 * @param {string} path - the operation path, such as `/v1/search`.
 * @param {string} apiKey - the API key, or `''` for keyless.
 * @returns {string} the absolute endpoint URL.
 */
export function endpoint(baseURL, path, apiKey) {
  const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL
  return `${base}${path}${apiKey ? '' : '/public'}`
}

/**
 * Send one request to the Keenable API and return the parsed JSON body.
 *
 * Redirects fail before the `Location` target is contacted, because the
 * request may carry the API key. Every non-2xx response is a provider error;
 * its message keeps Keenable's own explanation (for example "Fetching from
 * private/internal hosts is not allowed") and, for a keyless rate limit, says
 * how to lift it.
 *
 * @param {object} request
 * @param {string} request.url - the absolute endpoint URL, with any query.
 * @param {'GET' | 'POST'} request.method - the HTTP method.
 * @param {unknown} [request.body] - JSON body for a POST.
 * @param {string} request.apiKey - the API key, or `''` for keyless.
 * @param {string} request.label - operation name used in messages ("Keenable search").
 * @param {AbortSignal} [request.signal] - cancellation signal.
 * @returns {Promise<any>} the parsed response body.
 */
export async function callKeenable({ url, method, body, apiKey, label, signal }) {
  const headers = {
    'accept': 'application/json',
    'user-agent': USER_AGENT,
    'x-keenable-title': APP_TITLE,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (apiKey) headers['x-api-key'] = apiKey

  let response
  try {
    response = await fetch(url, {
      method,
      redirect: 'error',
      headers,
      ...body === undefined ? {} : { body: JSON.stringify(body) },
      ...signal === undefined ? {} : { signal },
    })
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw aborted(label, error)
    throw providerError(`${label} request failed: ${describe(error)}`, error)
  }

  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw aborted(label, error)
    // Gateway errors often carry no JSON; the status is the real signal then.
    if (!response.ok) throw providerError(`${label} failed (HTTP ${response.status})`, error)
    throw providerError(`${label} returned an unprocessable response body: ${describe(error)}`, error)
  }

  if (!response.ok) throw providerError(failureMessage(label, response.status, payload, apiKey))
  return payload
}

/**
 * Build the message for a Keenable-reported failure from its `error` and
 * `message` fields.
 */
function failureMessage(label, status, payload, apiKey) {
  const parts = []
  for (const field of ['error', 'message']) {
    const value = typeof payload?.[field] === 'string' ? payload[field].trim() : ''
    if (value && !parts.includes(value)) parts.push(value)
  }
  let message = `${label} failed (HTTP ${status})${parts.length ? `: ${parts.join(': ')}` : ''}`
  if (status === 429 && !apiKey) {
    message += ' Without an API key, requests share a per-IP limit; set the plugin\'s apiKey or KEENABLE_API_KEY to lift it.'
  }
  return message
}

function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

/** True for a `fetch`/`AbortSignal` abort, which is cancellation, not failure. */
export function isAbortError(error) {
  return typeof error === 'object' && error !== null && error.name === 'AbortError'
}

/** `WEB_ABORTED`: cancellation is not a provider error. */
export function aborted(label, cause) {
  return new WebError(`${label} aborted`, 'WEB_ABORTED', cause === undefined ? {} : { cause })
}

/** `WEB_PROVIDER_ERROR`: the seam's catch-all for a provider's own failure. */
export function providerError(message, cause) {
  return new WebError(message, 'WEB_PROVIDER_ERROR', cause === undefined ? {} : { cause })
}

/** True when `baseURL` is an HTTPS URL with no credentials, query or fragment. */
export function isValidBaseUrl(baseURL) {
  if (typeof baseURL !== 'string' || !URL.canParse(baseURL)) return false
  const url = new URL(baseURL)
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
}

/** True for a positive integer. */
export function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

/** The trimmed string when it is non-blank, else `undefined`. */
export function nonblank(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
