/**
 * The registry behind the single wrapper: registration order, the three
 * outcomes, and the fail-open accounting.
 *
 * @module
 */

import type { Settings } from './config.ts'
import { parseLine } from './parse.ts'

/** The result shape `CommandResult` carries, restated without importing it. */
export interface InterceptedResult {
  readonly kind: 'success' | 'error'
  readonly text?: string
}

/** One call as an interceptor sees it. */
export interface InterceptorRequest {
  /** The exact receiving agent, as the caller passed it. */
  readonly agent: unknown
  /** The line the pipeline is about to run, after any replacement so far. */
  readonly line: string
  /** The parsed name, or `undefined` when the line is not command-shaped. */
  readonly name: string | undefined
  /** Everything after the name, verbatim. */
  readonly args: string
  /** The submitted attachments, unchanged. */
  readonly attachments: readonly unknown[]
  /** The caller's cancellation signal. */
  readonly signal: AbortSignal
  /** 0 for the first pass; each `replace` starts the next pass. */
  readonly hop: number
}

/** What one interceptor decides. */
export type InterceptorOutcome =
  /** Run the next interceptor, then the original command. */
  | { readonly kind: 'next' }
  /** Settle without running the command. */
  | { readonly kind: 'answer'; readonly result: InterceptedResult }
  /** Run this line instead, through the whole pipeline again. */
  | { readonly kind: 'replace'; readonly line: string }

/** One registered interceptor. */
export interface CommandInterceptor {
  /** Stable, unique id; a repeat is refused rather than shadowing the first. */
  readonly id: string
  /** Only lines naming one of these commands reach `intercept`. */
  readonly match?: { readonly command?: string | readonly string[] }
  /** Run before `intercept`; `false` skips this interceptor. May be async. */
  readonly when?: (request: InterceptorRequest) => boolean | Promise<boolean>
  /** Decide. Returning nothing means `next`. May be async — an interceptor that awaits is what defers a command. */
  readonly intercept: (request: InterceptorRequest) => InterceptorOutcome | undefined | Promise<InterceptorOutcome | undefined>
}

/** What the registry has seen since it was mounted. */
export interface InterceptorStats {
  /** Calls that entered the pipeline at all. */
  readonly calls: number
  /** Answers that settled a call. */
  readonly answered: number
  /** Replacements performed. */
  readonly replaced: number
  /** Interceptors that threw and were skipped. */
  readonly failed: number
  /** Calls that passed through untouched. */
  readonly passed: number
}

type Log = (message: string) => void

function renderThrown(value: unknown): string {
  try {
    return value instanceof Error ? value.message : String(value)
  } catch {
    return '<unrenderable thrown value>'
  }
}

function matchesName(interceptor: CommandInterceptor, name: string | undefined): boolean {
  const wanted = interceptor.match?.command
  if (wanted === undefined) return true
  if (name === undefined) return false
  return typeof wanted === 'string' ? wanted === name : wanted.includes(name)
}

/**
 * The ordered set of interceptors one mount runs.
 *
 * Interceptors run in registration order and the first outcome other than
 * `next` wins for that pass — so a plugin that must see a command before any
 * other plugin registers with `use()` early, and the mount's order is the
 * deployment's declaration order.
 */
export class InterceptorRegistry {
  readonly #entries: CommandInterceptor[] = []
  readonly #settings: Settings
  readonly #log: Log
  #counts = { calls: 0, answered: 0, replaced: 0, failed: 0, passed: 0 }

  /**
   * @param settings - validated row settings.
   * @param log - receives interception and failure lines; the caller decides where they go.
   */
  constructor(settings: Settings, log: Log) {
    this.#settings = settings
    this.#log = log
  }

  /** The settings this mount runs with. */
  get settings(): Settings {
    return this.#settings
  }

  /**
   * Register one interceptor.
   * @param interceptor - id, optional matcher/predicate, and the decision itself.
   * @returns the exact disposer that removes this interceptor; idempotent.
   */
  use(interceptor: CommandInterceptor): () => void {
    if (typeof interceptor?.id !== 'string' || interceptor.id.length === 0) {
      throw new TypeError('command-interceptor: an interceptor needs a non-empty id')
    }
    if (typeof interceptor.intercept !== 'function') {
      throw new TypeError(`command-interceptor: interceptor "${interceptor.id}" needs an intercept function`)
    }
    if (this.#entries.some(entry => entry.id === interceptor.id)) {
      throw new TypeError(`command-interceptor: interceptor "${interceptor.id}" is already registered`)
    }
    const entry = Object.freeze(interceptor)
    this.#entries.push(entry)
    let removed = false
    return () => {
      if (removed) return
      removed = true
      const index = this.#entries.indexOf(entry)
      if (index >= 0) this.#entries.splice(index, 1)
    }
  }

  /** The registered ids, in the order they run. */
  list(): readonly string[] {
    return Object.freeze(this.#entries.map(entry => entry.id))
  }

  /** A snapshot of the counters. */
  stats(): InterceptorStats {
    return Object.freeze({ ...this.#counts })
  }

  /**
   * Run one call through the pipeline.
   * @param delegate - the service method the wrapper displaced.
   * @param agent - exact receiving agent.
   * @param line - the typed line.
   * @param attachments - submitted attachments.
   * @param signal - the caller's signal.
   * @returns whatever the answering interceptor settled, or the delegate's value.
   */
  async dispatch(
    delegate: (agent: never, line: string, attachments: never, signal: AbortSignal) => Promise<unknown>,
    agent: unknown,
    line: string,
    attachments: readonly unknown[],
    signal: AbortSignal,
  ): Promise<unknown> {
    this.#counts.calls += 1
    const call = (nextLine: string): Promise<unknown> => delegate(
      agent as never,
      nextLine,
      attachments as never,
      signal,
    )
    // A cancelled call is nobody's to hold: hand it straight to the service,
    // which reports the cancellation itself.
    if (signal.aborted) {
      this.#counts.passed += 1
      return call(line)
    }
    if (this.#entries.length === 0) {
      this.#counts.passed += 1
      return call(line)
    }

    let current = line
    for (let hop = 0; hop <= this.#settings.maxHops; hop += 1) {
      const parsed = parseLine(current)
      const request: InterceptorRequest = Object.freeze({
        agent,
        line: current,
        name: parsed?.name,
        args: parsed?.args ?? '',
        attachments,
        signal,
        hop,
      })
      let replaced = false
      for (const entry of this.#entries) {
        if (!matchesName(entry, request.name)) continue
        let outcome: InterceptorOutcome | undefined
        try {
          if (entry.when !== undefined && !await entry.when(request)) continue
          outcome = await entry.intercept(request)
        } catch (error: unknown) {
          // Fail open, and say so: an interceptor that cannot decide must not
          // be able to stop a command the user typed.
          this.#counts.failed += 1
          this.#log(`command-interceptor: "${entry.id}" threw and was skipped: ${renderThrown(error)}`)
          continue
        }
        if (outcome === undefined || outcome.kind === 'next') continue
        if (outcome.kind === 'answer') {
          if (this.#settings.mode === 'observe') {
            this.#log(`command-interceptor: observe — "${entry.id}" would answer /${request.name ?? '?'} (${outcome.result.kind})`)
            continue
          }
          this.#counts.answered += 1
          if (this.#settings.report) this.#log(`command-interceptor: "${entry.id}" answered /${request.name ?? '?'} (${outcome.result.kind})`)
          return Object.freeze({
            commandId: `interceptor:${entry.id}`,
            result: Object.freeze({
              kind: outcome.result.kind,
              ...outcome.result.text === undefined ? {} : { text: outcome.result.text },
            }),
          })
        }
        if (typeof outcome.line !== 'string' || outcome.line.length === 0) {
          this.#log(`command-interceptor: "${entry.id}" returned a replace without a line and was skipped`)
          continue
        }
        if (this.#settings.mode === 'observe') {
          this.#log(`command-interceptor: observe — "${entry.id}" would replace /${request.name ?? '?'} with ${JSON.stringify(outcome.line)}`)
          continue
        }
        this.#counts.replaced += 1
        if (this.#settings.report) this.#log(`command-interceptor: "${entry.id}" replaced ${JSON.stringify(current)} with ${JSON.stringify(outcome.line)}`)
        current = outcome.line
        replaced = true
        break
      }
      if (!replaced) {
        this.#counts.passed += 1
        return call(current)
      }
    }
    this.#log(`command-interceptor: replacement limit (${this.#settings.maxHops}) reached; running ${JSON.stringify(current)} as typed`)
    this.#counts.passed += 1
    return call(current)
  }
}
