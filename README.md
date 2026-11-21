# @argszero/dsh-command-interceptor

One interception point for every typed slash command.

The harness's commands service emits only `commands/change`, and
`commands.execute()` runs with no waterfall around it. A plugin that has to look
at a command before it runs — to defer it until the plugin's own activation
finished, to answer it itself, or to rewrite it — has one place to stand:
replace `execute`. Two plugins standing there drop each other's wrapper, because
each one's base is the other's wrapper.

This plugin takes that wrapper once and fans it out to a registry. Any number of
plugins register interceptors, the first outcome other than `next` wins in
registration order, and the displaced method is put back when this plugin
unloads. It answers
[discussion #14014](https://github.com/deepseek-ai/deepseek-harness/discussions/14014).

## What it does, and what it does not

It runs **between the caller and the command handler**, on the same
`(agent, line, attachments, signal)` call the UI and the SDK already make. That
is enough to defer, inspect, answer or rewrite a command.

It does **not** add a durable event, and it cannot change when the harness
records the command: an answered command produces no `command/run` /
`command/done` pair, because those records belong to the execution this plugin
replaced. If a durable trace matters, answer by routing to a registered command
with `replace`, or append your own event from the interceptor.

It is a service-method shadow, not a new event. Every method this plugin adds is
its own; the only harness method it touches is `execute` on the service
instance, which it restores exactly.

## Install

```sh
dsh plugin add @argszero/dsh-command-interceptor
```

or mount the row yourself:

```yaml
- id: command-interceptor
  name: '@argszero/dsh-command-interceptor'
  config:
    mode: answer    # answer | observe | off
    maxHops: 4
    report: true
```

`observe` is the safe first mount: every interceptor runs and logs what it would
have decided, and every command still runs exactly as typed.

## Use it

A plugin that wants to intercept commands declares the service:

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'
export const inject = ['commandInterceptors']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commandInterceptors.registry.use({
    id: 'my-plugin/defer-until-ready',
    match: { command: ['build', 'deploy'] },
    intercept: async (request) => {
      await ready                       // defer: the command waits here
      return { kind: 'next' }           // then runs untouched
    },
  }))
}
```

Three outcomes:

| outcome | what happens |
|---|---|
| `{ kind: 'next' }` or nothing | the next interceptor runs, then the command |
| `{ kind: 'answer', result: { kind: 'success' \| 'error', text? } }` | settles the call; the command handler does not run |
| `{ kind: 'replace', line: '/other args' }` | the pipeline re-enters with that line |

`match.command` takes one name or an array; `when(request)` is an optional
predicate. Both may be async. Registration order decides who runs first, and a
repeated `id` is refused rather than silently shadowing the first.

An interceptor that throws is logged, counted, and skipped — a broken
interceptor must never be able to swallow a command the user typed. A call that
arrives already cancelled goes straight to the service.

The registry reports `list()` and `stats()`
(`calls`/`answered`/`replaced`/`failed`/`passed`).

## Why the instance, not the prototype

The gateway reads `Reflect.get(receiver, implementation)` per call
(`packages/api/gateway/src/index.ts`), so an own-property method shadow is what
both the in-process callers and the Remote dispatch see. The wrapper chains onto
whatever it finds — including a wrapper another plugin installed first — and
unwinding it never removes a wrapper installed on top of it.

## Requirements

Peer dependencies: `@deepseek-ai/cordis`, `@deepseek-ai/dsh-commands`. No
runtime dependencies, no files touched, no tools added.
