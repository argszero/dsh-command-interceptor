/**
 * The pipeline, on a stand-in for the commands service: the three outcomes,
 * the guards, and the restore.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { InterceptorRegistry, installCommandShadow, normalizeConfig } from '../lib/index.js'

const signal = () => new AbortController().signal

function fakeService() {
  const seen = []
  const service = {
    seen,
    async execute(agent, line, attachments, sig) {
      seen.push(line)
      return { commandId: 'real', result: { kind: 'success', text: `ran ${line}` } }
    },
  }
  return service
}

function mount(settings = {}, { service = fakeService(), log = () => {} } = {}) {
  const lines = []
  const sink = message => { lines.push(message); log(message) }
  const registry = new InterceptorRegistry(normalizeConfig(settings), sink)
  const uninstall = installCommandShadow({ view: service, registry, log: sink })
  return { service, registry, uninstall, lines }
}

test('next delegates, and the original command runs', async () => {
  const w = mount()
  w.registry.use({ id: 'a', intercept: () => ({ kind: 'next' }) })
  const execution = await w.service.execute(null, '/echo hi', [], signal())
  assert.equal(execution.commandId, 'real')
  assert.equal(execution.result.text, 'ran /echo hi')
  assert.deepEqual(w.service.seen, ['/echo hi'])
})

test('answering settles the call and the command never runs', async () => {
  const w = mount()
  w.registry.use({ id: 'a', intercept: () => ({ kind: 'answer', result: { kind: 'success', text: 'answered' } }) })
  const execution = await w.service.execute(null, '/echo hi', [], signal())
  assert.equal(execution.commandId, 'interceptor:a')
  assert.deepEqual(execution.result, { kind: 'success', text: 'answered' })
  assert.deepEqual(w.service.seen, [], 'the displaced method was not reached')
})

test('an async interceptor defers the command until it resolves', async () => {
  const w = mount()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const order = []
  w.registry.use({ id: 'slow', intercept: async () => { await gate; order.push('interceptor'); return { kind: 'next' } } })
  const pending = w.service.execute(null, '/echo hi', [], signal())
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(w.service.seen, [], 'the command is held while the interceptor awaits')
  release()
  await pending
  assert.deepEqual(w.service.seen, ['/echo hi'])
  assert.deepEqual(order, ['interceptor'])
})

test('replace re-enters with the new line, and the next pass sees it', async () => {
  const w = mount()
  const hops = []
  w.registry.use({
    id: 'rewrite',
    intercept: request => {
      hops.push([request.line, request.hop])
      return request.hop === 0 ? { kind: 'replace', line: '/echo bye' } : { kind: 'next' }
    },
  })
  const execution = await w.service.execute(null, '/echo hi', [], signal())
  assert.deepEqual(hops, [['/echo hi', 0], ['/echo bye', 1]])
  assert.deepEqual(w.service.seen, ['/echo bye'])
  assert.equal(execution.commandId, 'real')
})

test('two interceptors that rewrite into each other stop at maxHops and run the line', async () => {
  const w = mount({ maxHops: 2 })
  w.registry.use({ id: 'loop', intercept: () => ({ kind: 'replace', line: '/echo loop' }) })
  await w.service.execute(null, '/echo hi', [], signal())
  assert.deepEqual(w.service.seen, ['/echo loop'], 'the command still runs exactly once')
  assert.match(w.lines.at(-1), /replacement limit \(2\)/)
})

test('the first non-next outcome wins, in registration order', async () => {
  const w = mount()
  w.registry.use({ id: 'first', intercept: () => ({ kind: 'answer', result: { kind: 'success', text: 'first' } }) })
  w.registry.use({ id: 'second', intercept: () => ({ kind: 'answer', result: { kind: 'success', text: 'second' } }) })
  const execution = await w.service.execute(null, '/echo hi', [], signal())
  assert.equal(execution.result.text, 'first')
})

test('match.command narrows an interceptor to the names it declares', async () => {
  const w = mount()
  w.registry.use({ id: 'compact', match: { command: 'compact' }, intercept: () => ({ kind: 'answer', result: { kind: 'success', text: 'x' } }) })
  await w.service.execute(null, '/echo hi', [], signal())
  assert.deepEqual(w.service.seen, ['/echo hi'], 'another command passes through')
  const execution = await w.service.execute(null, '/compact', [], signal())
  assert.equal(execution.result.text, 'x')
  w.registry.use({ id: 'list', match: { command: ['a', 'b'] }, intercept: () => ({ kind: 'answer', result: { kind: 'error', text: 'y' } }) })
  assert.equal((await w.service.execute(null, '/b', [], signal())).result.text, 'y')
})

test('a predicate that says no skips the interceptor, and may be async', async () => {
  const w = mount()
  w.registry.use({ id: 'p', when: async request => request.args === ' yes', intercept: () => ({ kind: 'answer', result: { kind: 'success', text: 'matched' } }) })
  await w.service.execute(null, '/echo no', [], signal())
  assert.deepEqual(w.service.seen, ['/echo no'])
  assert.equal((await w.service.execute(null, '/echo yes', [], signal())).result.text, 'matched')
})

test('an interceptor that throws is skipped and counted, never blocking the command', async () => {
  const w = mount()
  w.registry.use({ id: 'bad', intercept: () => { throw new Error('boom') } })
  const execution = await w.service.execute(null, '/echo hi', [], signal())
  assert.equal(execution.commandId, 'real', 'the command still ran')
  assert.equal(w.registry.stats().failed, 1)
  assert.match(w.lines[0], /"bad" threw and was skipped: boom/)
})

test('a cancelled call is handed to the service, not held by the pipeline', async () => {
  const w = mount()
  const controller = new AbortController()
  controller.abort()
  let called = false
  w.registry.use({ id: 'a', intercept: () => { called = true; return { kind: 'answer', result: { kind: 'success' } } } })
  await w.service.execute(null, '/echo hi', [], controller.signal)
  assert.equal(called, false, 'interceptors are not consulted for a cancelled call')
  assert.deepEqual(w.service.seen, ['/echo hi'])
})

test('observe runs the interceptors, counts them, and changes nothing', async () => {
  const w = mount({ mode: 'observe' })
  w.registry.use({ id: 'a', intercept: () => ({ kind: 'answer', result: { kind: 'success', text: 'would answer' } }) })
  const execution = await w.service.execute(null, '/echo hi', [], signal())
  assert.equal(execution.commandId, 'real')
  assert.equal(w.registry.stats().answered, 0)
  assert.match(w.lines[0], /observe — "a" would answer \/echo/)
})

test('a repeated id is refused rather than shadowing the first', () => {
  const w = mount()
  w.registry.use({ id: 'a', intercept: () => ({ kind: 'next' }) })
  assert.throws(() => w.registry.use({ id: 'a', intercept: () => ({ kind: 'next' }) }), /already registered/)
  assert.throws(() => w.registry.use({ id: '', intercept: () => ({ kind: 'next' }) }), /non-empty id/)
  assert.deepEqual(w.registry.list(), ['a'])
})

test('the disposer removes exactly its own interceptor', async () => {
  const w = mount()
  const gone = w.registry.use({ id: 'a', intercept: () => ({ kind: 'answer', result: { kind: 'success', text: 'a' } }) })
  w.registry.use({ id: 'b', intercept: () => ({ kind: 'answer', result: { kind: 'success', text: 'b' } }) })
  gone()
  gone()
  assert.deepEqual(w.registry.list(), ['b'])
  assert.equal((await w.service.execute(null, '/echo hi', [], signal())).result.text, 'b')
})

test('restore puts the prototype method back, leaving no own property', () => {
  class Commands { async execute() { return { commandId: 'real' } } }
  const service = new Commands()
  const registry = new InterceptorRegistry(normalizeConfig({}), () => {})
  const uninstall = installCommandShadow({ view: service, registry, log: () => {} })
  assert.equal(Object.hasOwn(service, 'execute'), true)
  uninstall()
  assert.equal(Object.hasOwn(service, 'execute'), false)
  assert.equal(service.execute, Commands.prototype.execute)
})

test('restore puts back an own property an earlier wrapper installed', () => {
  const previous = async () => ({ commandId: 'earlier' })
  const service = { execute: previous }
  const registry = new InterceptorRegistry(normalizeConfig({}), () => {})
  const uninstall = installCommandShadow({ view: service, registry, log: () => {} })
  assert.notEqual(service.execute, previous)
  uninstall()
  assert.equal(service.execute, previous, 'chained, not clobbered')
})

test('the wrapper chains onto an earlier own-property wrapper instead of dropping it', async () => {
  const seen = []
  const earlier = async function (agent, line) { seen.push(['earlier', line]); return { commandId: 'earlier' } }
  const service = { execute: earlier }
  const registry = new InterceptorRegistry(normalizeConfig({}), () => {})
  installCommandShadow({ view: service, registry, log: () => {} })
  const execution = await service.execute(null, '/echo hi', [], signal())
  assert.equal(execution.commandId, 'earlier')
  assert.deepEqual(seen, [['earlier', '/echo hi']])
})

test('a service with no execute is refused, not silently accepted', () => {
  assert.throws(
    () => installCommandShadow({ view: {}, registry: new InterceptorRegistry(normalizeConfig({}), () => {}), log: () => {} }),
    /no callable execute method/,
  )
  assert.throws(() => installCommandShadow({ view: null, registry: new InterceptorRegistry(normalizeConfig({}), () => {}), log: () => {} }), /not an object/)
})

test('the displaced method runs with the service as its receiver', async () => {
  // Regression: a bare function reference loses `this`, and the real
  // `CommandRuntime.execute` fails on its first `this.view` read.
  class Commands {
    constructor() { this.seen = [] }
    async execute(agent, line) { this.seen.push(line); return { commandId: 'real' } }
  }
  const service = new Commands()
  const registry = new InterceptorRegistry(normalizeConfig({}), () => {})
  installCommandShadow({ view: service, registry, log: () => {} })
  registry.use({ id: 'pass', intercept: () => ({ kind: 'next' }) })
  const execution = await service.execute(null, '/echo hi', [], signal())
  assert.equal(execution.commandId, 'real')
  assert.deepEqual(service.seen, ['/echo hi'], 'the method recorded through `this`')
})
