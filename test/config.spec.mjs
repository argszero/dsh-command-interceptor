/** The row's configuration: defaults, refusals, and immutability. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_HOPS_LIMIT, MODES, normalizeConfig } from '../lib/index.js'

test('the defaults are the ones the patch row documents', () => {
  const settings = normalizeConfig()
  assert.equal(settings.mode, 'answer')
  assert.equal(settings.maxHops, 4)
  assert.equal(settings.report, true)
  assert.deepEqual(normalizeConfig(null), settings)
})

test('every documented mode is accepted', () => {
  for (const mode of MODES) assert.equal(normalizeConfig({ mode }).mode, mode)
})

test('a mode this plugin cannot honour is refused, not ignored', () => {
  assert.throws(() => normalizeConfig({ mode: 'strip' }), /mode must be one of/)
})

test('maxHops is a bounded integer', () => {
  assert.throws(() => normalizeConfig({ maxHops: -1 }), /maxHops must be an integer/)
  assert.throws(() => normalizeConfig({ maxHops: 1.5 }), /maxHops must be an integer/)
  assert.throws(() => normalizeConfig({ maxHops: MAX_HOPS_LIMIT + 1 }), /maxHops must be an integer/)
  assert.equal(normalizeConfig({ maxHops: 0 }).maxHops, 0)
})

test('report is a boolean, and the settings cannot be mutated', () => {
  assert.throws(() => normalizeConfig({ report: 'yes' }), /report must be a boolean/)
  const settings = normalizeConfig({ mode: 'observe' })
  assert.throws(() => { 'use strict'; settings.mode = 'off' })
  assert.equal(settings.mode, 'observe')
})

test('a config that is not an object is refused', () => {
  assert.throws(() => normalizeConfig('answer'), /config must be an object/)
  assert.throws(() => normalizeConfig([]), /config must be an object/)
})
