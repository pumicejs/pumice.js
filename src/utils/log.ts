/**
 * Writes the framework's progress lines (registered routes, the listening
 * address) to stdout.
 *
 * Every such line goes through here, so a future `logger` option replaces
 * one function (docs/development/roadmap.md, "Quiet by default").
 */
export function logInfo(...values: unknown[]): void {
  // eslint-disable-next-line no-console -- the framework's one stdout writer, see above
  console.log(...values);
}
