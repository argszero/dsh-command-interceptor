/** The grammar, mirrored from the service it wraps. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLine } from '../lib/index.js'

test('a command line splits into name and verbatim arguments', () => {
  assert.deepEqual(parseLine('/compact'), { name: 'compact', args: '' })
  assert.deepEqual(parseLine('/compact now'), { name: 'compact', args: ' now' })
  assert.deepEqual(parseLine('/feedback  héllo '), { name: 'feedback', args: '  héllo ' })
  assert.deepEqual(parseLine('/a-b_c9 x'), { name: 'a-b_c9', args: ' x' })
})

test('only a slash and a lowercase name at the very start counts', () => {
  for (const line of ['', 'hello', ' /compact', '/Compact', '/9lives', '/compact!x', '//x']) {
    assert.equal(parseLine(line), undefined, line)
  }
})

test('the separator may be whitespace, and only whitespace', () => {
  assert.equal(parseLine('/compact\tx')?.args, '\tx')
  assert.equal(parseLine('/compact\nx')?.args, '\nx')
})
