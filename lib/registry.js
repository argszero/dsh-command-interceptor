/**
 * The registry behind the single wrapper: registration order, the three
 * outcomes, and the fail-open accounting.
 *
 * @module
 */
import { parseLine } from "./parse.js";
function renderThrown(value) {
    try {
        return value instanceof Error ? value.message : String(value);
    }
    catch {
        return '<unrenderable thrown value>';
    }
}
function matchesName(interceptor, name) {
    const wanted = interceptor.match?.command;
    if (wanted === undefined)
        return true;
    if (name === undefined)
        return false;
    return typeof wanted === 'string' ? wanted === name : wanted.includes(name);
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
    #entries = [];
    #settings;
    #log;
    #counts = { calls: 0, answered: 0, replaced: 0, failed: 0, passed: 0 };
    /**
     * @param settings - validated row settings.
     * @param log - receives interception and failure lines; the caller decides where they go.
     */
    constructor(settings, log) {
        this.#settings = settings;
        this.#log = log;
    }
    /** The settings this mount runs with. */
    get settings() {
        return this.#settings;
    }
    /**
     * Register one interceptor.
     * @param interceptor - id, optional matcher/predicate, and the decision itself.
     * @returns the exact disposer that removes this interceptor; idempotent.
     */
    use(interceptor) {
        if (typeof interceptor?.id !== 'string' || interceptor.id.length === 0) {
            throw new TypeError('command-interceptor: an interceptor needs a non-empty id');
        }
        if (typeof interceptor.intercept !== 'function') {
            throw new TypeError(`command-interceptor: interceptor "${interceptor.id}" needs an intercept function`);
        }
        if (this.#entries.some(entry => entry.id === interceptor.id)) {
            throw new TypeError(`command-interceptor: interceptor "${interceptor.id}" is already registered`);
        }
        const entry = Object.freeze(interceptor);
        this.#entries.push(entry);
        let removed = false;
        return () => {
            if (removed)
                return;
            removed = true;
            const index = this.#entries.indexOf(entry);
            if (index >= 0)
                this.#entries.splice(index, 1);
        };
    }
    /** The registered ids, in the order they run. */
    list() {
        return Object.freeze(this.#entries.map(entry => entry.id));
    }
    /** A snapshot of the counters. */
    stats() {
        return Object.freeze({ ...this.#counts });
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
    async dispatch(delegate, agent, line, attachments, signal) {
        this.#counts.calls += 1;
        const call = (nextLine) => delegate(agent, nextLine, attachments, signal);
        // A cancelled call is nobody's to hold: hand it straight to the service,
        // which reports the cancellation itself.
        if (signal.aborted) {
            this.#counts.passed += 1;
            return call(line);
        }
        if (this.#entries.length === 0) {
            this.#counts.passed += 1;
            return call(line);
        }
        let current = line;
        for (let hop = 0; hop <= this.#settings.maxHops; hop += 1) {
            const parsed = parseLine(current);
            const request = Object.freeze({
                agent,
                line: current,
                name: parsed?.name,
                args: parsed?.args ?? '',
                attachments,
                signal,
                hop,
            });
            let replaced = false;
            for (const entry of this.#entries) {
                if (!matchesName(entry, request.name))
                    continue;
                let outcome;
                try {
                    if (entry.when !== undefined && !await entry.when(request))
                        continue;
                    outcome = await entry.intercept(request);
                }
                catch (error) {
                    // Fail open, and say so: an interceptor that cannot decide must not
                    // be able to stop a command the user typed.
                    this.#counts.failed += 1;
                    this.#log(`command-interceptor: "${entry.id}" threw and was skipped: ${renderThrown(error)}`);
                    continue;
                }
                if (outcome === undefined || outcome.kind === 'next')
                    continue;
                if (outcome.kind === 'answer') {
                    if (this.#settings.mode === 'observe') {
                        this.#log(`command-interceptor: observe — "${entry.id}" would answer /${request.name ?? '?'} (${outcome.result.kind})`);
                        continue;
                    }
                    this.#counts.answered += 1;
                    if (this.#settings.report)
                        this.#log(`command-interceptor: "${entry.id}" answered /${request.name ?? '?'} (${outcome.result.kind})`);
                    return Object.freeze({
                        commandId: `interceptor:${entry.id}`,
                        result: Object.freeze({
                            kind: outcome.result.kind,
                            ...outcome.result.text === undefined ? {} : { text: outcome.result.text },
                        }),
                    });
                }
                if (typeof outcome.line !== 'string' || outcome.line.length === 0) {
                    this.#log(`command-interceptor: "${entry.id}" returned a replace without a line and was skipped`);
                    continue;
                }
                if (this.#settings.mode === 'observe') {
                    this.#log(`command-interceptor: observe — "${entry.id}" would replace /${request.name ?? '?'} with ${JSON.stringify(outcome.line)}`);
                    continue;
                }
                this.#counts.replaced += 1;
                if (this.#settings.report)
                    this.#log(`command-interceptor: "${entry.id}" replaced ${JSON.stringify(current)} with ${JSON.stringify(outcome.line)}`);
                current = outcome.line;
                replaced = true;
                break;
            }
            if (!replaced) {
                this.#counts.passed += 1;
                return call(current);
            }
        }
        this.#log(`command-interceptor: replacement limit (${this.#settings.maxHops}) reached; running ${JSON.stringify(current)} as typed`);
        this.#counts.passed += 1;
        return call(current);
    }
}
