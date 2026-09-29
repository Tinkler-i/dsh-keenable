import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { KeenableSearchProvider, buildSearchBody, mapSearchResponse } from '../src/search.js'
import { call, hit, stubFetch } from './helpers.js'

const keyless = { apiKey: '', baseURL: 'https://api.keenable.ai', maxSnippetChars: 500 }
const keyed = { ...keyless, apiKey: 'keen_test_secret' }

afterEach(() => mock.restoreAll())

describe('search request', () => {
  it('goes to the public endpoint without a key, naming the app, with no key header', async () => {
    const api = stubFetch({ results: [] })
    await new KeenableSearchProvider(keyless).search({ query: 'ada lovelace', maxResults: 8 })
    const { url, init, headers, body } = call(api)
    assert.equal(url, 'https://api.keenable.ai/v1/search/public')
    assert.equal(init.method, 'POST')
    assert.equal(init.redirect, 'error')
    assert.equal(headers.get('x-keenable-title'), 'dsh-keenable')
    assert.equal(headers.get('x-api-key'), null)
    assert.match(headers.get('user-agent'), /^@keenable\/dsh-keenable\/\d/)
    assert.deepEqual(body, { query: 'ada lovelace', snippet_max_length: 500, max_results: 8 })
  })

  it('goes to the authenticated endpoint with X-API-Key when a key is set', async () => {
    const api = stubFetch({ results: [] })
    await new KeenableSearchProvider(keyed).search({ query: 'q' })
    const { url, headers } = call(api)
    assert.equal(url, 'https://api.keenable.ai/v1/search')
    assert.equal(headers.get('x-api-key'), 'keen_test_secret')
    assert.equal(headers.get('x-keenable-title'), 'dsh-keenable')
  })

  it('omits max_results when the request has none and caps it at the API limit', () => {
    assert.deepEqual(buildSearchBody({ query: 'q' }, keyless), { query: 'q', snippet_max_length: 500 })
    assert.equal(buildSearchBody({ query: 'q', maxResults: 80 }, keyless).max_results, 50)
    assert.equal('max_results' in buildSearchBody({ query: 'q', maxResults: 0 }, keyless), false)
  })

  it('forwards the abort signal', async () => {
    const api = stubFetch({ results: [] })
    const controller = new AbortController()
    await new KeenableSearchProvider(keyless).search({ query: 'q' }, controller.signal)
    assert.equal(call(api).init.signal, controller.signal)
  })
})

describe('search results', () => {
  it('reads snippet, collapses its line breaks, and maps the publication date', () => {
    const { sources, truncated } = mapSearchResponse({ results: [hit()] }, keyless)
    assert.equal(truncated, false)
    assert.deepEqual(sources, [{
      url: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
      title: 'Ada Lovelace',
      snippet: 'Augusta Ada King, Countess of Lovelace, was an English mathematician.',
      publishedAt: '2026-09-01T00:00:00Z',
    }])
  })

  it('falls back to description only when snippet is empty, and omits absent fields', () => {
    const { sources } = mapSearchResponse({ results: [
      hit({ url: 'https://a.test/', snippet: '', description: 'Summary', published_at: undefined, title: ' ' }),
      hit({ url: 'https://b.test/', snippet: undefined, description: '' }),
    ] }, keyless)
    assert.deepEqual(sources[0], { url: 'https://a.test/', snippet: 'Summary' })
    assert.equal('snippet' in sources[1], false)
  })

  it('enforces the excerpt budget itself, since snippet_max_length is only a hint', () => {
    const { sources } = mapSearchResponse({ results: [hit({ snippet: 'word '.repeat(200) })] }, { maxSnippetChars: 180 })
    assert.ok(sources[0].snippet.length <= 180)
    assert.ok(sources[0].snippet.endsWith('…'))
  })

  it('drops results without a safe http(s) URL and duplicates', () => {
    const { sources } = mapSearchResponse({ results: [
      hit({ url: 'javascript:alert(1)' }), hit({ url: 'https://user:pw@a.test/' }), hit({ url: 'not a url' }),
      null, 'text', hit({ url: 'https://a.test/x' }), hit({ url: 'https://a.test/x' }),
    ] }, keyless)
    assert.deepEqual(sources.map(source => source.url), ['https://a.test/x'])
  })

  it('accepts an empty result set', async () => {
    stubFetch({ query: 'q', results: [] })
    assert.deepEqual(await new KeenableSearchProvider(keyless).search({ query: 'q' }), { sources: [], truncated: false })
  })

  for (const body of [{}, { results: null }, { results: {} }, [], 'null']) {
    it(`reports a malformed body ${JSON.stringify(body)} as a provider error`, async () => {
      stubFetch(body)
      await assert.rejects(new KeenableSearchProvider(keyless).search({ query: 'q' }),
        { code: 'WEB_PROVIDER_ERROR', message: /unprocessable/ })
    })
  }
})

describe('search failures', () => {
  it('points a keyless rate limit at the optional key', async () => {
    stubFetch({ error: 'Rate limit exceeded', message: 'Public API hourly limit reached.', retryAfter: 120 },
      { status: 429, headers: { 'retry-after': '120' } })
    await assert.rejects(new KeenableSearchProvider(keyless).search({ query: 'q' }), error => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR')
      assert.match(error.message, /HTTP 429\): Rate limit exceeded: Public API hourly limit reached\./)
      assert.match(error.message, /KEENABLE_API_KEY/)
      return true
    })
  })

  it('does not suggest a key when a keyed request is rate limited or rejected', async () => {
    for (const status of [401, 429]) {
      stubFetch({ error: status === 401 ? 'Authentication failed' : 'Rate limit exceeded' }, { status })
      await assert.rejects(new KeenableSearchProvider(keyed).search({ query: 'q' }), error => {
        assert.match(error.message, new RegExp(`HTTP ${status}`))
        assert.doesNotMatch(error.message, /KEENABLE_API_KEY|keen_test_secret/)
        return true
      })
      mock.restoreAll()
    }
  })

  it('reports a non-JSON gateway error by its status', async () => {
    stubFetch('<html>bad gateway</html>', { status: 502 })
    await assert.rejects(new KeenableSearchProvider(keyless).search({ query: 'q' }),
      { code: 'WEB_PROVIDER_ERROR', message: 'Keenable search failed (HTTP 502)' })
  })

  it('reports a network failure', async () => {
    mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed') })
    await assert.rejects(new KeenableSearchProvider(keyless).search({ query: 'q' }),
      { code: 'WEB_PROVIDER_ERROR', message: 'Keenable search request failed: fetch failed' })
  })

  it('reports cancellation as WEB_ABORTED, whatever the abort reason', async () => {
    const controller = new AbortController()
    mock.method(globalThis, 'fetch', async () => {
      controller.abort(new Error('custom timeout reason'))
      throw controller.signal.reason
    })
    await assert.rejects(new KeenableSearchProvider(keyless).search({ query: 'q' }, controller.signal),
      { code: 'WEB_ABORTED', message: 'Keenable search aborted' })
  })
})

describe('search availability', () => {
  it('needs no key, only a sane configuration', () => {
    assert.equal(new KeenableSearchProvider(keyless).available(), true)
    for (const baseURL of ['http://api.keenable.ai', 'https://user:pw@api.keenable.ai', 'https://api.keenable.ai?x=1', 'nope']) {
      assert.equal(new KeenableSearchProvider({ ...keyless, baseURL }).available(), false, baseURL)
    }
    for (const maxSnippetChars of [179, 10_001, 1.5]) {
      assert.equal(new KeenableSearchProvider({ ...keyless, maxSnippetChars }).available(), false, String(maxSnippetChars))
    }
  })
})
