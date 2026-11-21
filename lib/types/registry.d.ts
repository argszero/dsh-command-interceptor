/**
 * The registry behind the single wrapper: registration order, the three
 * outcomes, and the fail-open accounting.
 *
 * @module
 */
import type { Settings } from './config.ts';
/** The result shape `CommandResult` carries, restated without importing it. */
export interface InterceptedResult {
    readonly kind: 'success' | 'error';
    readonly text?: string;
}
/** One call as an interceptor sees it. */
export interface InterceptorRequest {
    /** The exact receiving agent, as the caller passed it. */
    readonly agent: unknown;
    /** The line the pipeline is about to run, after any replacement so far. */
    readonly line: string;
    /** The parsed name, or `undefined` when the line is not command-shaped. */
    readonly name: string | undefined;
    /** Everything after the name, verbatim. */
    readonly args: string;
    /** The submitted attachments, unchanged. */
    readonly attachments: readonly unknown[];
    /** The caller's cancellation signal. */
    readonly signal: AbortSignal;
    /** 0 for the first pass; each `replace` starts the next pass. */
    readonly hop: number;
}
/** What one interceptor decides. */
export type InterceptorOutcome = 
/** Run the next interceptor, then the original command. */
{
    readonly kind: 'next';
}
/** Settle without running the command. */
 | {
    readonly kind: 'answer';
    readonly result: InterceptedResult;
}
/** Run this line instead, through the whole pipeline again. */
 | {
    readonly kind: 'replace';
    readonly line: string;
};
/** One registered interceptor. */
export interface CommandInterceptor {
    /** Stable, unique id; a repeat is refused rather than shadowing the first. */
    readonly id: string;
    /** Only lines naming one of these commands reach `intercept`. */
    readonly match?: {
        readonly command?: string | readonly string[];
    };
    /** Run before `intercept`; `false` skips this interceptor. May be async. */
    readonly when?: (request: InterceptorRequest) => boolean | Promise<boolean>;
    /** Decide. Returning nothing means `next`. May be async — an interceptor that awaits is what defers a command. */
    readonly intercept: (request: InterceptorRequest) => InterceptorOutcome | undefined | Promise<InterceptorOutcome | undefined>;
}
/** What the registry has seen since it was mounted. */
export interface InterceptorStats {
    /** Calls that entered the pipeline at all. */
    readonly calls: number;
    /** Answers that settled a call. */
    readonly answered: number;
    /** Replacements performed. */
    readonly replaced: number;
    /** Interceptors that threw and were skipped. */
    readonly failed: number;
    /** Calls that passed through untouched. */
    readonly passed: number;
}
type Log = (message: string) => void;
/**
 * The ordered set of interceptors one mount runs.
 *
 * Interceptors run in registration order and the first outcome other than
 * `next` wins for that pass — so a plugin that must see a command before any
 * other plugin registers with `use()` early, and the mount's order is the
 * deployment's declaration order.
 */
export declare class InterceptorRegistry {
    #private;
    /**
     * @param settings - validated row settings.
     * @param log - receives interception and failure lines; the caller decides where they go.
     */
    constructor(settings: Settings, log: Log);
    /** The settings this mount runs with. */
    get settings(): Settings;
    /**
     * Register one interceptor.
     * @param interceptor - id, optional matcher/predicate, and the decision itself.
     * @returns the exact disposer that removes this interceptor; idempotent.
     */
    use(interceptor: CommandInterceptor): () => void;
    /** The registered ids, in the order they run. */
    list(): readonly string[];
    /** A snapshot of the counters. */
    stats(): InterceptorStats;
    /**
     * Run one call through the pipeline.
     * @param delegate - the service method the wrapper displaced.
     * @param agent - exact receiving agent.
     * @param line - the typed line.
     * @param attachments - submitted attachments.
     * @param signal - the caller's signal.
     * @returns whatever the answering interceptor settled, or the delegate's value.
     */
    dispatch(delegate: (agent: never, line: string, attachments: never, signal: AbortSignal) => Promise<unknown>, agent: unknown, line: string, attachments: readonly unknown[], signal: AbortSignal): Promise<unknown>;
}
export {};
//# sourceMappingURL=registry.d.ts.map