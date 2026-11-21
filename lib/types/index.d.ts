/**
 * One interception point for every typed slash command.
 *
 * The harness's commands service emits only `commands/change` and runs
 * `execute()` with no waterfall around it, so a plugin that must inspect,
 * defer, answer or replace a typed command can only replace
 * `ctx.commands.execute` — and two plugins replacing one method drop each
 * other's wrapper (each unwrap can be the other's base). This plugin takes that
 * one wrapper itself and fans it out to a registry, so any number of plugins
 * compose in registration order, and the displaced method is restored when this
 * plugin unloads.
 *
 * The seam is the service instance, not the prototype: the gateway reads
 * `Reflect.get(receiver, implementation)` per call
 * (`packages/api/gateway/src/index.ts`), so an own-property method shadow is
 * what both the in-process callers and the Remote dispatch see.
 *
 * @module
 */
import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type { Settings } from './config.ts';
import { InterceptorRegistry } from './registry.ts';
export * from './config.ts';
export * from './parse.ts';
export * from './registry.ts';
/** Cordis plugin name; the bundle row and the service both read it. */
export declare const name = "command-interceptor";
/** The commands service is a hard requirement: without it there is nothing to wrap. */
export declare const inject: string[];
/** The Cordis name this plugin's registry is registered under. */
export declare const SERVICE_NAME = "commandInterceptors";
/**
 * Reach the real service instance behind a Cordis service view.
 * @param view - the value `ctx.get(name)` or `ctx.<name>` returned.
 * @returns the instance the view wraps, or the value itself when it is not a view.
 */
export declare function unwrapService(view: unknown): object;
/** What one shadow installation needs. */
export interface ShadowOptions {
    /** The commands service, view or instance. */
    readonly view: unknown;
    /** The registry the wrapper dispatches into. */
    readonly registry: InterceptorRegistry;
    /** Receives the wrapper's own diagnostics. */
    readonly log: (message: string) => void;
}
/**
 * Install the single `execute` wrapper on the commands instance.
 *
 * The previous method is captured as it is found — an own property installed by
 * an earlier wrapper included — so this plugin chains rather than clobbers.
 *
 * @param options - service, registry and log sink.
 * @returns a disposer that puts the displaced method back.
 * @throws TypeError when the service has no callable `execute`.
 */
export declare function installCommandShadow(options: ShadowOptions): () => void;
/**
 * The `commandInterceptors` service: the registry, plus the wrapper it drives.
 *
 * Mount it through `apply` or a row; a plugin that wants to intercept commands
 * declares `inject: ['commandInterceptors']` and calls `use()`.
 */
export declare class CommandInterceptors extends Service {
    /** The registry this mount dispatches into. */
    readonly registry: InterceptorRegistry;
    /**
     * @param ctx - owning context.
     * @param settings - validated settings.
     */
    constructor(ctx: Context, settings: Settings);
}
/**
 * Mount the registry and its wrapper.
 * @param ctx - the plugin's context.
 * @param config - the row's configuration.
 */
export declare function apply(ctx: Context, config?: unknown): void;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=index.d.ts.map