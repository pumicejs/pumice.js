import type {
  MiddlewareHandler,
  MiddlewareRegistration,
} from "../types/middleware.js";
import type { ContextRefinementRule } from "../types/plugin.js";

/**
 * Fluent builder returned by `server.middleware()`.
 *
 * A middleware is scoped to the directory of the file that calls
 * `server.middleware()` (a `middleware.ts` or `*.mw.ts` during route
 * discovery) and runs for every route registered in that directory or any
 * nested directory. Routing groups like `(auth-stuff)` count as directories
 * for scoping even though they are stripped from the URL path.
 *
 * Chain order:
 *
 * ```text
 * server.middleware()
 *   ├── .describe(string)        // optional human-readable description (manifest / logs)
 *   └── .handle((c, next) => ...) // finalizes — registers the middleware
 * ```
 *
 * Execution order: outermost (root) → innermost (deepest directory). Within
 * a single directory, middlewares run in registration order.
 *
 * Hono-style flow:
 * - Call `next()` to continue down the chain into the route pipeline; the
 *   resolved value is the final `Response`.
 * - Return (or resolve to) a `Response` to short-circuit the route entirely.
 * - `(c, next) => next()` is a no-op passthrough.
 *
 * @example
 * ```ts
 * // src/routes/(staff)/middleware.ts — applies to every route under (staff)
 * server.middleware()
 *   .describe("Staff-only guard")
 *   .handle(async (c, next) => {
 *     if (!c.auth.data?.user.isStaff) {
 *       return createApiJsonErrorResponse(403, { code: "FORBIDDEN", message: "Staff only." });
 *     }
 *     return next();
 *   });
 * ```
 */
export interface MiddlewareBuilderStage<
  TBaseContext extends object = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultRouteConfig extends object = {},
> {
  /**
   * Attaches a human-readable description to the middleware.
   *
   * Surfaced in registration logs and in the route manager — useful for
   * tooling that introspects the running app. Has no runtime effect on the
   * pipeline.
   *
   * @example `.describe("Enforces staff-only access")`
   */
  describe(
    description: string,
  ): MiddlewareBuilderStage<
    TBaseContext,
    TContextRefinementRules,
    TDefaultRouteConfig
  >;

  /**
   * Finalizes the middleware with its request-time handler.
   *
   * The handler receives `(c, next)`:
   * - `c` is a typed Hono context with plugin-contributed extensions
   *   (e.g. `c.auth`) and any default-config refinements applied.
   * - `next()` returns a `Promise<Response>` — `await`-ing it runs the rest
   *   of the chain plus the route pipeline (validation → procedures → handler).
   * - Returning (or resolving to) a `Response` short-circuits the chain.
   * - Returning `void` without calling `next()` is treated as a passthrough
   *   (the chain continues), but this is a defensive recovery — call
   *   `next()` explicitly when you mean to continue.
   *
   * @example
   * ```ts
   * .handle(async (c, next) => {
   *   const start = Date.now();
   *   const response = await next();
   *   console.log(`${c.req.method} ${c.req.path} -> ${response.status} (${Date.now() - start}ms)`);
   *   return response;
   * });
   * ```
   */
  handle(
    handler: MiddlewareHandler<
      TBaseContext,
      TContextRefinementRules,
      TDefaultRouteConfig
    >,
  ): void;
}

/**
 * Creates a fresh middleware builder.
 *
 * Internal-ish — `server.middleware()` calls this to wire the registration
 * callback to the current middleware file. Callers building custom
 * integrations can use this factory directly with their own `register` function.
 */
export function createMiddlewareBuilder<
  TBaseContext extends object = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultRouteConfig extends object = {},
>(
  register: MiddlewareRegistration<
    TBaseContext,
    TContextRefinementRules,
    TDefaultRouteConfig
  >,
): MiddlewareBuilderStage<
  TBaseContext,
  TContextRefinementRules,
  TDefaultRouteConfig
> {
  let description: string | undefined;

  const builder: MiddlewareBuilderStage<
    TBaseContext,
    TContextRefinementRules,
    TDefaultRouteConfig
  > = {
    describe(nextDescription) {
      description = nextDescription;
      return builder;
    },
    handle(handler) {
      register({
        handle: handler,
        description,
      });
    },
  };

  return builder;
}
