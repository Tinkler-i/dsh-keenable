import { mock } from 'node:test'

/**
 * Replace global fetch with a stub answering `status` and `body` (a value is
 * sent as JSON, a string as-is), and return the mock so tests can read calls.
 */
export function stubFetch(body, { status = 200, headers = {} } = {}) {
  return mock.method(globalThis, 'fetch', async () => new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'content-type': 'application/json', ...headers } },
  ))
}

/** The URL and init of the stub's n-th call. */
export function call(fetchMock, index = 0) {
  const [url, init] = fetchMock.mock.calls[index].arguments
  return { url: String(url), init, headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : undefined }
}

/** A search result the way the API really sends it: text in snippet, empty description. */
export function hit(overrides = {}) {
  return {
    title: 'Ada Lovelace',
    url: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
    description: '',
    snippet: 'Augusta Ada King, Countess of Lovelace,\n\nwas an English mathematician.',
    published_at: '2026-09-01T00:00:00Z',
    acquired_at: '2026-09-02T00:00:00Z',
    ...overrides,
  }
}
