/**
 * The plugin loaded into a real Cordis context with the real `dsh-web` seam and
 * the real model-facing `web_search` / `web_fetch` tools: config defaults,
 * registration, selection, the key fallback, disposal, and what the model reads.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import SystemPromptRuntime from '@deepseek-ai/dsh-system-prompt'
import * as toolWeb from '@deepseek-ai/dsh-tool-web'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as plugin from '../src/index.js'
import { call, hit, stubFetch } from './helpers.js'

afterEach(() => mock.restoreAll())

/** The composition the bundle patch produces, built by hand. */
async function harness({ config = {}, env } = {}) {
  const ctx = new Context()
  if (env) ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: env }]))
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(SystemPromptRuntime, { persona: '' })
  await ctx.plugin(WebRuntime, { searchProvider: 'keenable', fetchProvider: 'keenable' })
  const fiber = await ctx.plugin(plugin, config)
  await ctx.plugin(toolWeb, { search: true, fetch: true })
  return { ctx, fiber }
}

let calls = 0
function invoke(ctx, name, args) {
  return ctx.tools.execute({ callId: `test-${calls += 1}`, name, arguments: args, signal: new AbortController().signal })
}
const text = result => result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')

describe('config', () => {
  it('materializes the documented defaults, with no key', () => {
    assert.deepEqual(plugin.Config({}), {
      baseURL: 'https://api.keenable.ai',
      maxSnippetChars: 500,
      fetchLive: true,
      maxBodyChars: 100_000,
    })
  })

  it('rejects values outside the API limits', () => {
    for (const bad of [{ maxSnippetChars: 100 }, { maxSnippetChars: 20_000 }, { maxBodyChars: 0 }, { maxBodyChars: 200_000 }, { maxSnippetChars: 1.5 }]) {
      assert.throws(() => plugin.Config(bad), undefined, JSON.stringify(bad))
    }
  })

  it('marks the key as a secret, so settings responses redact it', () => {
    assert.equal(plugin.Config.dict.apiKey.meta.role, 'secret')
  })
})

describe('registration', () => {
  it('serves both capabilities through the seam without a key, and unregisters on dispose', async () => {
    stubFetch({ results: [hit()] })
    const { ctx, fiber } = await harness()
    const result = await ctx.web.search({ query: 'ada lovelace', maxResults: 5 })
    assert.equal(result.sources[0].url, 'https://en.wikipedia.org/wiki/Ada_Lovelace')
    mock.restoreAll()
    stubFetch({ url: 'https://example.com/', content: 'Example Domain' })
    assert.equal((await ctx.web.fetch({ url: 'https://example.com' })).body.content, 'Example Domain')
    await fiber.dispose()
    await assert.rejects(ctx.web.search({ query: 'q' }), { code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
    await assert.rejects(ctx.web.fetch({ url: 'https://example.com' }), { code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })

  it('lets the seam own the final source count', async () => {
    stubFetch({ results: ['a', 'b', 'c'].map(name => hit({ url: `https://${name}.test/` })) })
    const { ctx } = await harness()
    const result = await ctx.web.search({ query: 'q', maxResults: 2 })
    assert.equal(result.sources.length, 2)
    assert.equal(result.truncated, true)
  })

  it('uses KEENABLE_API_KEY from the launch environment, and a configured key wins', async () => {
    let api = stubFetch({ results: [] })
    let { ctx } = await harness({ env: { KEENABLE_API_KEY: 'keen_from_env' } })
    await ctx.web.search({ query: 'q' })
    assert.equal(call(api).headers.get('x-api-key'), 'keen_from_env')
    assert.equal(new URL(call(api).url).pathname, '/v1/search')
    mock.restoreAll()
    api = stubFetch({ results: [] });
    ({ ctx } = await harness({ config: { apiKey: 'keen_configured' }, env: { KEENABLE_API_KEY: 'keen_from_env' } }))
    await ctx.web.search({ query: 'q' })
    assert.equal(call(api).headers.get('x-api-key'), 'keen_configured')
  })

  it('treats a blank key as no key', async () => {
    const api = stubFetch({ results: [] })
    const { ctx } = await harness({ config: { apiKey: '  ' }, env: {} })
    await ctx.web.search({ query: 'q' })
    assert.equal(new URL(call(api).url).pathname, '/v1/search/public')
    assert.equal(call(api).headers.get('x-api-key'), null)
  })
})

describe('model-facing tools', () => {
  it('renders web_search sources with excerpts and dates, and asks for citations', async () => {
    stubFetch({ results: [hit()] })
    const { ctx } = await harness()
    const result = await invoke(ctx, 'web_search', { queries: ['ada lovelace'] })
    assert.equal(result.isError, false)
    const rendered = text(result)
    assert.match(rendered, /\[Ada Lovelace\]\(https:\/\/en\.wikipedia\.org\/wiki\/Ada_Lovelace\)/)
    assert.match(rendered, /was an English mathematician\. \(2026-09-01T00:00:00Z\)/)
    assert.match(rendered, /untrusted data/)
    assert.match(rendered, /Cite the relevant URLs/)
  })

  it('renders web_fetch page text', async () => {
    stubFetch({ url: 'https://example.com/', content: '# Example Domain\n\nThis domain is for use in examples.' })
    const { ctx } = await harness()
    const result = await invoke(ctx, 'web_fetch', { url: 'https://example.com' })
    assert.equal(result.isError, false)
    assert.match(text(result), /Fetched https:\/\/example\.com\/ \(HTTP 200\)/)
    assert.match(text(result), /This domain is for use in examples\./)
  })

  it('turns a refused URL into a tool error, without a request', async () => {
    const api = stubFetch({ content: 'x' })
    const { ctx } = await harness()
    const result = await invoke(ctx, 'web_fetch', { url: 'file:///etc/passwd' })
    assert.equal(result.isError, true)
    assert.equal(api.mock.callCount(), 0)
  })

  it('shows the keyless rate-limit hint to the model', async () => {
    stubFetch({ error: 'Rate limit exceeded', message: 'Public API hourly limit reached.' }, { status: 429 })
    const { ctx } = await harness()
    const result = await invoke(ctx, 'web_search', { queries: ['q'] })
    assert.equal(result.isError, true)
    assert.match(text(result), /KEENABLE_API_KEY/)
  })
})
