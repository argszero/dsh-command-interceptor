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
import { normalizeConfig } from "./config.js";
import { InterceptorRegistry } from "./registry.js";
export * from "./config.js";
export * from "./parse.js";
export * from "./registry.js";
/** Cordis plugin name; the bundle row and the service both read it. */
export const name = 'command-interceptor';
/** The commands service is a hard requirement: without it there is nothing to wrap. */
export const inject = ['commands'];
/** The Cordis name this plugin's registry is registered under. */
export const SERVICE_NAME = 'commandInterceptors';
/** Cordis's own unwrapping symbol: a service view answers it with the instance. */
const ORIGINAL = Symbol.for('cordis.original');
/**
 * Reach the real service instance behind a Cordis service view.
 * @param view - the value `ctx.get(name)` or `ctx.<name>` returned.
 * @returns the instance the view wraps, or the value itself when it is not a view.
 */
export function unwrapService(view) {
    if (view === null || (typeof view !== 'object' && typeof view !== 'function')) {
        throw new TypeError('command-interceptor: the commands service is not an object');
    }
    const inner = view[ORIGINAL];
    return (typeof inner === 'object' || typeof inner === 'function') && inner !== null
        ? inner
        : view;
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
export function installCommandShadow(options) {
    const target = unwrapService(options.view);
    const previous = Reflect.get(target, 'execute');
    if (typeof previous !== 'function')
        throw new TypeError('command-interceptor: the commands service has no callable execute method');
    const hadOwn = Object.hasOwn(target, 'execute');
    // The displaced method must run with the service as its receiver: every
    // method on it reads `this.view`, `this.layers` and `this.ctx`. Passing the
    // bare function reference loses that and fails on the first `this` read —
    // measured against the real service, which threw
    // `Cannot read properties of undefined (reading 'view')`.
    const delegate = (agent, line, attachments, signal) => Reflect.apply(previous, target, [agent, line, attachments, signal]);
    const wrapped = function execute(agent, line, attachments, signal) {
        return options.registry.dispatch(delegate, agent, line, attachments, signal);
    };
    Object.defineProperty(target, 'execute', { value: wrapped, writable: true, enumerable: false, configurable: true });
    let restored = false;
    return () => {
        if (restored)
            return;
        restored = true;
        // A wrapper installed on top of this one owns the property now; unwinding
        // through it would break the chain that plugin built.
        if (Reflect.get(target, 'execute') !== wrapped) {
            options.log('command-interceptor: execute was wrapped again after this plugin; leaving the outer wrapper in place');
            return;
        }
        if (hadOwn) {
            Object.defineProperty(target, 'execute', { value: previous, writable: true, enumerable: true, configurable: true });
            return;
        }
        Reflect.deleteProperty(target, 'execute');
    };
}
/**
 * The `commandInterceptors` service: the registry, plus the wrapper it drives.
 *
 * Mount it through `apply` or a row; a plugin that wants to intercept commands
 * declares `inject: ['commandInterceptors']` and calls `use()`.
 */
export class CommandInterceptors extends Service {
    /** The registry this mount dispatches into. */
    registry;
    /**
     * @param ctx - owning context.
     * @param settings - validated settings.
     */
    constructor(ctx, settings) {
        super(ctx, SERVICE_NAME);
        const log = (message) => { ctx.logger.warn(message); };
        this.registry = new InterceptorRegistry(settings, log);
        ctx.effect(() => installCommandShadow({ view: ctx.get('commands'), registry: this.registry, log }), 'command-interceptor: execute shadow');
    }
}
/**
 * Mount the registry and its wrapper.
 * @param ctx - the plugin's context.
 * @param config - the row's configuration.
 */
export function apply(ctx, config) {
    const settings = normalizeConfig(config);
    if (settings.mode === 'off')
        return;
    ctx.plugin(CommandInterceptors, settings);
}
export default { name, inject, apply };
