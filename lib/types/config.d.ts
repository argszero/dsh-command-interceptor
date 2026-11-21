/**
 * The row's configuration: what it defaults to, and what it refuses.
 *
 * @module
 */
/** How the installed wrapper treats what an interceptor returns. */
export type Mode = 'answer' | 'observe' | 'off';
/** Every mode this plugin honours. */
export declare const MODES: readonly ["answer", "observe", "off"];
/** Largest re-entry count a `replace` outcome may reach. */
export declare const MAX_HOPS_LIMIT = 16;
/** Validated settings a mount runs with. */
export interface Settings {
    /**
     * `answer` (default) lets an interceptor answer, replace, or defer a command.
     * `observe` runs every interceptor and counts what it would have decided, but
     * the original call always runs — the shape to install first on a live
     * deployment.
     * `off` mounts no wrapper at all.
     */
    readonly mode: Mode;
    /** How many `replace` outcomes deep one invocation may go before it delegates. */
    readonly maxHops: number;
    /** Log each interception, replacement and interceptor failure. */
    readonly report: boolean;
}
/**
 * Validate one row's configuration.
 * @param raw - the row's `config`, or nothing.
 * @returns frozen settings.
 * @throws TypeError naming the refused key.
 */
export declare function normalizeConfig(raw?: unknown): Settings;
//# sourceMappingURL=config.d.ts.map