/** Mounted the way a profile mounts it: a real Cordis context and a real service row. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import plugin, { SERVICE_NAME, unwrapService } from '../lib/index.js'

/** The commands service as a composition supplies it: registered under `commands`. */
class FakeCommands extends Service {
  constructor(ctx) {
    super(ctx, 'commands')
    this.seen = []
  }

  async execute(agent, line) {
    this.seen.push(line)
    return { commandId: 'real', result: { kind: 'success', text: `ran ${line}` } }
  }
}

test('mounting registers commandInterceptors and shadows the service instance', async () => {
  const ctx = new Context()
  ctx.plugin(FakeCommands)
  await new Promise(resolve => setImmediate(resolve))
  ctx.plugin(plugin, { mode: 'answer', report: false })
  await new Promise(resolve => setImmediate(resolve))
  const commands = ctx.get('commands')
  const instance = unwrapService(commands)
  assert.equal(Object.hasOwn(instance, 'execute'), true, 'the instance carries the wrapper, not the prototype')

  const service = ctx.get(SERVICE_NAME)
  assert.ok(service !== undefined, 'the registry is reachable under its service name')
  service.registry.use({ id: 'x', intercept: () => ({ kind: 'answer', result: { kind: 'success', text: 'from interceptor' } }) })

  const execution = await commands.execute(null, '/echo hi', [], new AbortController().signal)
  assert.equal(execution.commandId, 'interceptor:x')
  assert.deepEqual(ctx.get('commands').seen, [], 'the displaced method was not reached')
})

test('off mounts no wrapper and provides no service', async () => {
  const ctx = new Context()
  ctx.plugin(FakeCommands)
  await new Promise(resolve => setImmediate(resolve))
  ctx.plugin(plugin, { mode: 'off' })
  await new Promise(resolve => setImmediate(resolve))
  const instance = unwrapService(ctx.get('commands'))
  assert.equal(Object.hasOwn(instance, 'execute'), false)
  assert.equal(ctx.get(SERVICE_NAME), undefined)
})
