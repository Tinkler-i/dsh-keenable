/**
 * The browser half, loaded the way the Client module table loads it: the artifact
 * is evaluated with a `window.__ModuleLoader__` that captures its entry, and the
 * factory runs against a stubbed `react` and a stubbed Client context. That puts
 * the registration the Plugins page looks for, and the credential read/write the
 * page performs, under test without a browser.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

/** Enough of `react` for a class component to be constructed and inspected. */
const FakeReact = {
  Component: class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }

    setState(patch) {
      Object.assign(this.state, typeof patch === 'function' ? patch(this.state, this.props) : patch)
    }
  },
  createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
}

const loaded = []
globalThis.window = { __ModuleLoader__: { load: entry => loaded.push(entry) } }
await import('../src/client.js')

const entry = loaded[0]
const api = entry.factory(name => {
  if (name === 'react') return FakeReact
  throw new Error(`the browser half must not require ${name}`)
})

/**
 * A Client context with just the seams the page touches, recording what the
 * plugin registers and which credentials calls the page makes.
 */
function fakeContext({ describe, set } = {}) {
  const registered = []
  const effects = []
  const ctx = {
    effect(callback, label) {
      effects.push(label)
      return callback()
    },
    locale: {
      bind: ns => key => `${ns}.${key}`,
      register: (ns, dictionary) => {
        assert.ok(dictionary.en && dictionary.zh, 'dictionaries carry both languages')
        return () => {}
      },
    },
    slots: {
      inject: (owner, callback) => {
        callback()
        return () => {}
      },
      register: (registration, component) => {
        registered.push({ registration, component })
        return () => {}
      },
    },
    remote: {
      credentials: {
        describe: describe ?? (async () => ({ ok: true, value: {} })),
        set: set ?? (async () => ({ ok: true })),
      },
      $on: () => () => {},
    },
  }
  return { ctx, registered, effects }
}

/** A mounted page instance over `ctx`. */
function mount(ctx) {
  return new api.KeenableKeyForm({ ctx, t: key => `t:${key}` })
}

/** Every string in a rendered element tree, so tests can assert on the copy. */
function collectText(node) {
  if (node === null || node === undefined) return []
  if (typeof node === 'string') return [node]
  if (Array.isArray(node)) return node.flatMap(collectText)
  if (typeof node === 'object') return collectText(node.props?.children)
  return []
}

describe('client artifact', () => {
  it('registers exactly one entry, under the package name', () => {
    assert.equal(loaded.length, 1)
    assert.equal(entry.id, '@keenable/dsh-keenable')
    assert.equal(entry.id, api.apply ? entry.id : null)
  })

  it('exports the plugin body, its services, and its slot key', () => {
    assert.equal(typeof api.apply, 'function')
    assert.deepEqual(api.inject, ['slots', 'locale', 'remote', 'remote.credentials'])
    assert.equal(api.ROW_CONFIG_KEY, '@keenable/dsh-keenable#keenable')
    assert.equal(api.API_KEY_REF, 'KEENABLE_API_KEY')
    assert.equal(typeof api.KeenableKeyForm, 'function')
  })

  it('takes the row key from the package name and the row the bundle patch inserts', () => {
    assert.equal(api.ROW_CONFIG_KEY, `${entry.id}#keenable`)
  })
})

describe('registration', () => {
  it('gives the row a configuration page under the key the Plugins page looks up', () => {
    const { ctx, registered, effects } = fakeContext()
    api.apply(ctx)
    assert.equal(registered.length, 1)
    assert.equal(registered[0].registration.name, 'plugins.row.config')
    assert.equal(registered[0].registration.key, api.ROW_CONFIG_KEY)
    assert.equal(registered[0].registration.locale, api.NS)
    assert.deepEqual(effects, ['keenable: dictionaries', 'keenable: row configuration page'])
  })

  it('renders the page form through the registered slot entry, with its context and locale', () => {
    const { ctx, registered } = fakeContext()
    api.apply(ctx)
    const element = registered[0].component({ view: 'page', t: key => `slot:${key}` })
    assert.equal(element.type, api.KeenableKeyForm)
    assert.equal(element.props.ctx, ctx)
    assert.equal(element.props.t('save'), 'keenable.save')
    assert.equal(element.props.view, 'page')
  })
})

describe('the row page', () => {
  it('answers the summary view with its one-liner', () => {
    const { ctx } = fakeContext()
    const form = mount(ctx)
    form.props.view = 'summary'
    assert.equal(form.render(), 't:summary')
  })

  it('reads the credential reference the provider resolves', async () => {
    const asked = []
    const { ctx } = fakeContext({
      describe: async refs => {
        asked.push(refs)
        return { ok: true, value: { KEENABLE_API_KEY: { configured: true, writable: true } } }
      },
    })
    const form = mount(ctx)
    await form.refresh()
    assert.deepEqual(asked, [['KEENABLE_API_KEY']])
    assert.equal(form.state.configured, true)
    assert.equal(form.state.loading, false)
    assert.equal(form.state.unavailable, false)
    const element = form.render()
    assert.equal(element.props['data-keenable-key'], true)
    assert.ok(collectText(element).includes('t:configured'))
    assert.ok(collectText(element).includes('t:apiKey'))
  })

  it('treats a reference the Host has never seen as unwritten but writable', async () => {
    const { ctx } = fakeContext({ describe: async () => ({ ok: true, value: {} }) })
    const form = mount(ctx)
    await form.refresh()
    assert.equal(form.state.configured, false)
    assert.equal(form.state.writable, true)
  })

  it('reports an unanswered read as unknown rather than as no key', async () => {
    const { ctx } = fakeContext({ describe: async () => ({ ok: false, message: 'settings read-only' }) })
    const form = mount(ctx)
    await form.refresh()
    assert.equal(form.state.unavailable, true)
    assert.equal(form.state.configured, false)
  })

  it('survives a throwing read', async () => {
    const { ctx } = fakeContext({ describe: async () => { throw new Error('transport') } })
    const form = mount(ctx)
    await form.refresh()
    assert.equal(form.state.unavailable, true)
  })

  it('writes the key through the credentials domain and clears the field on success', async () => {
    const writes = []
    const { ctx } = fakeContext({
      describe: async () => ({ ok: true, value: { KEENABLE_API_KEY: { configured: true, writable: true } } }),
      set: async (ref, value) => {
        writes.push([ref, value])
        return { ok: true }
      },
    })
    const form = mount(ctx)
    form.state.value = '  keen_from_page  '
    await form.save()
    assert.deepEqual(writes, [['KEENABLE_API_KEY', 'keen_from_page']])
    assert.equal(form.state.value, '')
    assert.equal(form.state.status, 'saved')
    assert.equal(form.state.configured, true)
  })

  it('never writes a blank field', async () => {
    const writes = []
    const { ctx } = fakeContext({ set: async (ref, value) => { writes.push([ref, value]); return { ok: true } } })
    const form = mount(ctx)
    form.state.value = '   '
    await form.save()
    assert.deepEqual(writes, [])
    assert.equal(form.state.status, 'blank')
  })

  it('keeps the typed key when the Host refuses the write', async () => {
    const { ctx } = fakeContext({ set: async () => ({ ok: false, message: 'read-only deployment' }) })
    const form = mount(ctx)
    form.state.value = 'keen_rejected'
    await form.save()
    assert.equal(form.state.status, 'failed')
    assert.equal(form.state.value, 'keen_rejected')
    assert.equal(form.state.detail, 'read-only deployment')
    assert.ok(collectText(form.render()).includes('t:failed (read-only deployment)'))
  })

  it('reports a rejected write that answers with nothing', async () => {
    const { ctx } = fakeContext({ set: async () => { throw new Error('transport') } })
    const form = mount(ctx)
    form.state.value = 'keen_rejected'
    await form.save()
    assert.equal(form.state.status, 'failed')
    assert.equal(form.state.detail, 'transport')
  })

  it('treats a rejection with no message as a failure, not as a save', async () => {
    const { ctx } = fakeContext({ set: async () => ({ ok: false }) })
    const form = mount(ctx)
    form.state.value = 'keen_rejected'
    await form.save()
    assert.equal(form.state.status, 'failed')
    assert.equal(form.state.value, 'keen_rejected', 'the typed key survives a refusal')
    assert.equal(form.state.detail, '')
  })

  it('never claims which endpoints the provider uses', async () => {
    // The effective key can also come from the row's config or from the
    // environment Harness starts in, neither of which this page can see, so the
    // copy stays about the one reference it manages. Guarded here because the
    // review that caught the over-claim asked for it.
    const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /authenticated endpoints|public endpoints|带鉴权的接口|公共接口/)
  })
})
