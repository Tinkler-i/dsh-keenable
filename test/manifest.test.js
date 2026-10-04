/**
 * Guards the bundle manifest against the ways it can silently stop working: a
 * patch row naming a module the package does not export, a provider pin that
 * disagrees with the id the providers register under, or a peer range the
 * Harness compatibility check would refuse.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import yaml from 'js-yaml'
import { PROVIDER_ID, VERSION } from '../src/index.js'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const patch = yaml.load(readFileSync(new URL(manifest.dsh.bundle.patch, root), 'utf8'))
const rows = patch.flatMap(entry => Array.isArray(entry?.insert) ? entry.insert : [entry])

describe('bundle manifest', () => {
  it('declares a bundle patch and ships it', () => {
    assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
    assert.ok(manifest.files.includes('cordis.patch.yml'))
  })

  it('inserts the package once, by a name the package exports', () => {
    const own = rows.filter(row => row?.name?.startsWith(manifest.name))
    assert.deepEqual(own.map(row => row.name), [manifest.name])
    assert.ok(manifest.exports['.'])
  })

  it('pins both web capabilities to the registered provider id', () => {
    const web = rows.find(row => row.id === 'web')
    assert.equal(web.name, '@deepseek-ai/dsh-web')
    assert.deepEqual(web.config, { searchProvider: PROVIDER_ID, fetchProvider: PROVIDER_ID })
  })

  it('keeps the user agent version in step with package.json', () => {
    assert.equal(VERSION, manifest.version)
  })

  it('ships the browser half the Client module table loads', () => {
    assert.equal(manifest.exports['./client'], './src/client.js')
    assert.equal(manifest.dsh.client.platform, 'web')
    assert.ok(Array.isArray(manifest.dsh.client.inject))
    assert.ok(manifest.files.includes('src'), 'the published files include the browser half')
  })

  it('declares every DeepSeek package it imports as a peer, with an open range', () => {
    const imported = new Set()
    for (const file of ['index.js', 'http.js', 'search.js', 'fetch.js']) {
      const source = readFileSync(new URL(`src/${file}`, root), 'utf8')
      for (const [, name] of source.matchAll(/from '(@deepseek-ai\/[^']+)'/g)) imported.add(name)
    }
    assert.deepEqual([...imported].sort(), Object.keys(manifest.peerDependencies).sort())
    for (const [name, range] of Object.entries(manifest.peerDependencies)) {
      if (name.startsWith('@deepseek-ai/dsh')) assert.match(range, /^>=0\.1\.7-rc\.2$/, name)
    }
    assert.equal(manifest.dependencies, undefined)
  })
})
