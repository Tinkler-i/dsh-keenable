/**
 * Guarded live run: the real model-facing tools over the real seam against the
 * real Keenable API, with no key. Run with `npm run test:live`.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import SystemPromptRuntime from '@deepseek-ai/dsh-system-prompt'
import * as toolWeb from '@deepseek-ai/dsh-tool-web'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as plugin from '../src/index.js'

const live = process.env.KEENABLE_LIVE === '1'

async function harness() {
  const ctx = new Context()
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([]))
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(SystemPromptRuntime, { persona: '' })
  await ctx.plugin(WebRuntime, { searchProvider: 'keenable', fetchProvider: 'keenable' })
  await ctx.plugin(plugin, {})
  await ctx.plugin(toolWeb, { search: true, fetch: true })
  return ctx
}
let calls = 0
const invoke = (ctx, name, args) => ctx.tools.execute({ callId: `live-${calls += 1}`, name, arguments: args, signal: new AbortController().signal })
const text = result => result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')

describe('live, keyless', { skip: !live && 'set KEENABLE_LIVE=1' }, () => {
  it('answers web_search with sourced excerpts', async () => {
    const started = Date.now()
    const result = await invoke(await harness(), 'web_search', { queries: ['Ada Lovelace'] })
    assert.equal(result.isError, false, text(result))
    const rendered = text(result)
    const links = rendered.match(/^- \[/gm) ?? []
    assert.ok(links.length >= 3, rendered)
    process.stdout.write(`# web_search: ${links.length} sources, ${rendered.length} chars, ${Date.now() - started} ms\n`)
  })

  it('answers web_fetch with page text', async () => {
    const started = Date.now()
    const result = await invoke(await harness(), 'web_fetch', { url: 'https://example.com' })
    assert.equal(result.isError, false, text(result))
    assert.match(text(result), /Example Domain/)
    process.stdout.write(`# web_fetch: ${text(result).length} chars, ${Date.now() - started} ms\n`)
  })

  it('surfaces a refused private host as a tool error', async () => {
    const result = await invoke(await harness(), 'web_fetch', { url: 'http://localhost:3000/' })
    assert.equal(result.isError, true)
    process.stdout.write(`# private host: ${text(result).slice(0, 160).replace(/\s+/g, ' ')}\n`)
  })
})
