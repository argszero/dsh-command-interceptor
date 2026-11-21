/**
 * The row's configuration: what it defaults to, and what it refuses.
 *
 * @module
 */
/** Every mode this plugin honours. */
export const MODES = Object.freeze(['answer', 'observe', 'off']);
/** Largest re-entry count a `replace` outcome may reach. */
export const MAX_HOPS_LIMIT = 16;
const DEFAULTS = Object.freeze({ mode: 'answer', maxHops: 4, report: true });
/**
 * Validate one row's configuration.
 * @param raw - the row's `config`, or nothing.
 * @returns frozen settings.
 * @throws TypeError naming the refused key.
 */
export function normalizeConfig(raw) {
    if (raw === undefined || raw === null)
        return DEFAULTS;
    if (typeof raw !== 'object' || Array.isArray(raw))
        throw new TypeError('command-interceptor: config must be an object');
    const input = raw;
    const mode = input['mode'] ?? DEFAULTS.mode;
    if (typeof mode !== 'string' || !MODES.includes(mode)) {
        throw new TypeError(`command-interceptor: mode must be one of ${MODES.join(', ')}; received ${JSON.stringify(mode)}`);
    }
    const maxHops = input['maxHops'] ?? DEFAULTS.maxHops;
    if (typeof maxHops !== 'number' || !Number.isInteger(maxHops) || maxHops < 0 || maxHops > MAX_HOPS_LIMIT) {
        throw new TypeError(`command-interceptor: maxHops must be an integer between 0 and ${MAX_HOPS_LIMIT}; received ${JSON.stringify(maxHops)}`);
    }
    const report = input['report'] ?? DEFAULTS.report;
    if (typeof report !== 'boolean') {
        throw new TypeError(`command-interceptor: report must be a boolean; received ${JSON.stringify(report)}`);
    }
    return Object.freeze({ mode: mode, maxHops, report });
}
