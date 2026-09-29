import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { KeenableFetchProvider, buildFetchQuery, mapFetchResponse } from '../src/fetch.js'
import { call, stubFetch } from './helpers.js'

const keyless = { apiKey: '', baseURL: 'https://api.keenable.ai', live: true, maxBodyChars: 100_000, maxUrlLength: 2048 }
const keyed = { ...keyless, apiKey: 'keen_test_secret' }
const page = { url: 'https://example.com/', title: 'Example Domain', content: '# Example Domain\n\nThis domain is for use in examples.' }

afterEach(() => mock.restoreAll())

describe('fetch request', () => {
  it('goes to the public endpoint without a key, live, asking one character past the budget', async () => {
    const api = stubFetch(page)
    await new KeenableFetchProvider(keyless).fetch({ url: 'https://example.com' })
    const { url, init, headers } = call(api)
    const parsed = new URL(url)
    assert.equal(parsed.origin + parsed.pathname, 'https://api.keenable.ai/v1/fetch/public')
    assert.equal(parsed.searchParams.get('url'), 'https://example.com')
    assert.equal(parsed.searchParams.get('live'), 'true')
    assert.equal(parsed.searchParams.get('max_chars'), '100001')
    assert.equal(init.method, 'GET')
    assert.equal(init.redirect, 'error')
    assert.equal(headers.get('x-keenable-title'), 'dsh-keenable')
    assert.equal(headers.get('x-api-key'), null)
  })

  it('uses the authenticated endpoint with a key, and the index when live is off', async () => {
    const api = stubFetch(page)
    await new KeenableFetchProvider({ ...keyed, live: false }).fetch({ url: 'https://example.com' })
    const { url, headers } = call(api)
    assert.equal(new URL(url).pathname, '/v1/fetch')
    assert.equal(new URL(url).searchParams.has('live'), false)
    assert.equal(headers.get('x-api-key'), 'keen_test_secret')
    assert.equal(buildFetchQuery({ url: 'https://a.test' }, { live: false, maxBodyChars: 10 }), 'url=https%3A%2F%2Fa.test&max_chars=11')
  })

  for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'https://user:pw@example.com/', 'not a url', `https://example.com/${'a'.repeat(2048)}`]) {
    it(`rejects ${url.slice(0, 40)} locally, without a request`, async () => {
      const api = stubFetch(page)
      await assert.rejects(new KeenableFetchProvider(keyless).fetch({ url }), { code: 'WEB_INVALID_URL' })
      assert.equal(api.mock.callCount(), 0)
    })
  }
})

describe('fetch results', () => {
  it('returns the markdown as text with the final URL and a 200', async () => {
    stubFetch(page)
    assert.deepEqual(await new KeenableFetchProvider(keyless).fetch({ url: 'https://example.com' }), {
      url: 'https://example.com/',
      statusCode: 200,
      body: { kind: 'text', content: page.content },
      truncated: false,
    })
  })

  it('adds the title as a heading when the text does not open with it', () => {
    const titled = mapFetchResponse({ title: 'Example Domain', content: 'This domain is for use in examples.' }, 'https://a.test', { maxBodyChars: 1000 })
    assert.equal(titled.body.content, '# Example Domain\n\nThis domain is for use in examples.')
    const already = mapFetchResponse(page, 'https://a.test', { maxBodyChars: 1000 })
    assert.equal(already.body.content, page.content)
  })

  it('cuts a page longer than the budget and flags it', () => {
    const result = mapFetchResponse({ content: 'x'.repeat(11) }, 'https://a.test', { maxBodyChars: 10 })
    assert.equal(result.body.content, 'x'.repeat(10))
    assert.equal(result.truncated, true)
    assert.equal(result.url, 'https://a.test')
  })

  for (const body of [{}, { content: null }, [], 'null']) {
    it(`reports a malformed body ${JSON.stringify(body)} as a provider error`, async () => {
      stubFetch(body)
      await assert.rejects(new KeenableFetchProvider(keyless).fetch({ url: 'https://a.test' }),
        { code: 'WEB_PROVIDER_ERROR', message: /unprocessable/ })
    })
  }
})

describe('fetch failures', () => {
  it('keeps the API explanation for a refused private host', async () => {
    stubFetch({ error: 'Forbidden', message: 'Fetching from private/internal hosts is not allowed' }, { status: 403 })
    await assert.rejects(new KeenableFetchProvider(keyless).fetch({ url: 'http://localhost:3000/' }), {
      code: 'WEB_PROVIDER_ERROR',
      message: 'Keenable fetch failed (HTTP 403): Forbidden: Fetching from private/internal hosts is not allowed',
    })
  })

  it('points a keyless rate limit at the optional key', async () => {
    stubFetch({ error: 'Rate limit exceeded' }, { status: 429 })
    await assert.rejects(new KeenableFetchProvider(keyless).fetch({ url: 'https://a.test' }), { message: /KEENABLE_API_KEY/ })
  })

  it('reports cancellation as WEB_ABORTED', async () => {
    const controller = new AbortController()
    mock.method(globalThis, 'fetch', async () => {
      controller.abort()
      throw new DOMException('This operation was aborted', 'AbortError')
    })
    await assert.rejects(new KeenableFetchProvider(keyless).fetch({ url: 'https://a.test' }, controller.signal),
      { code: 'WEB_ABORTED' })
  })

  it('is available without a key, within the API limits', () => {
    assert.equal(new KeenableFetchProvider(keyless).available(), true)
    assert.equal(new KeenableFetchProvider({ ...keyless, maxBodyChars: 200_000 }).available(), false)
    assert.equal(new KeenableFetchProvider({ ...keyless, baseURL: 'http://api.keenable.ai' }).available(), false)
  })
})
