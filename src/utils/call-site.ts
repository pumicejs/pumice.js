import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Enough frames to get from `server.route()` through the builder, any helper
// the route file calls, and the module's top level.
const STACK_DEPTH = 64;

// The location at the end of a V8 frame: `at fn (/abs/file.ts:1:2)`,
// `at file:///abs/file.ts:1:2`, or a Windows `C:\abs\file.ts:1:2`.
const FRAME_LOCATION =
  /\(?((?:file:\/\/)?(?:\/|[A-Za-z]:[\\/])[^()]*?):\d+:\d+\)?\s*$/;

/**
 * Absolute paths of the source files on the current call stack, innermost
 * first.
 *
 * Used by route discovery to find which route or middleware file is
 * registering something, which the "file being imported" can't tell when one
 * route file imports another (the imported file runs while its importer is
 * still loading). Frames without a file location (native code, `eval`) are
 * skipped. Under a source-mapped runtime (tsx, Node's type stripping, Vitest)
 * the frames name the `.ts` files; for compiled output, the `.js` files —
 * the same files discovery imported in either case.
 */
export function callStackFilePaths(): string[] {
  const previousLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = STACK_DEPTH;
  const stack = new Error().stack ?? "";
  Error.stackTraceLimit = previousLimit;

  const paths: string[] = [];
  for (const line of stack.split("\n").slice(1)) {
    const location = FRAME_LOCATION.exec(line)?.[1];
    if (!location) {
      continue;
    }
    try {
      paths.push(
        resolve(
          location.startsWith("file://") ? fileURLToPath(location) : location,
        ),
      );
    } catch {
      // A malformed file URL can't name a discovered file; skip the frame.
    }
  }
  return paths;
}
