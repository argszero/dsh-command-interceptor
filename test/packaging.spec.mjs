/** What the published artifact promises, checked against what it ships. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as entry from '../lib/index.js'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const patch = readFileSync(new URL('cordis.patch.yml', root), 'utf8')

test('the entry exports what a loader row and the tests reach for', () => {
  assert.equal(entry.name, 'command-interceptor')
  assert.deepEqual([...entry.inject], ['commands'])
  assert.equal(typeof entry.apply, 'function')
  assert.equal(entry.default.name, entry.name)
  assert.equal(entry.default.apply, entry.apply)
})

test('the bundle row names this package, and its id matches the plugin name', () => {
  assert.match(patch, /name: '@argszero\/dsh-command-interceptor'/)
  assert.match(patch, new RegExp(`id: ${entry.name}`))
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('the package installs nothing at runtime', () => {
  assert.equal(manifest.dependencies, undefined, 'zero runtime dependencies is the contract')
  const peers = Object.keys(manifest.peerDependencies).sort()
  assert.deepEqual(peers, ['@deepseek-ai/cordis', '@deepseek-ai/dsh-commands'])
})

test('the peer range admits the reported line and the release line, explicitly', () => {
  const range = manifest.peerDependencies['@deepseek-ai/dsh-commands']
  // A bare `>=0.2.1-rc.2 <0.3.0` does NOT admit 0.2.2-rc.5: semver only allows a
  // prerelease whose own major.minor.patch appears in a comparator. Each line
  // therefore carries its own segment.
  assert.match(range, />=0\.2\.1-rc\.2/)
  assert.match(range, />=0\.2\.2-rc\.1/)
  assert.match(range, /<0\.3\.0/)
})

test('the entry imports nothing from the harness at runtime', () => {
  const source = readFileSync(new URL('lib/index.js', root), 'utf8')
  const specifiers = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1])
  assert.deepEqual(specifiers.filter(s => !s.startsWith('./')), ['@deepseek-ai/cordis'], 'only the framework, never the packages it extends')
})
