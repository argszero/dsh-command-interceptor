/**
 * The harness's own command grammar, mirrored rather than imported: a plugin
 * entry must not import the harness packages it extends at runtime (the row may
 * mount where the resolution differs), so the one regular expression the
 * service uses is copied here with its source named.
 *
 * @module
 */
/** One parsed slash-command line. */
export interface ParsedLine {
    /** The lowercase command name, without the leading slash. */
    readonly name: string;
    /** Everything after the name, verbatim — not trimmed, exactly as typed. */
    readonly args: string;
}
/**
 * Parse an exact slash command without normalizing its trailing input.
 *
 * Byte-identical to `parseCommand` in
 * `packages/interaction/commands/src/index.ts`,
 * `@deepseek-ai/dsh-commands@0.2.2-rc.5`.
 *
 * @param line - complete candidate command line.
 * @returns the parsed command, or `undefined` when the line is not a command.
 */
export declare function parseLine(line: string): ParsedLine | undefined;
//# sourceMappingURL=parse.d.ts.map