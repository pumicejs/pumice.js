import type {
  MiddlewareHandler,
  MiddlewareRegistration,
} from "../types/middleware.js";
import type { ContextRefinementRule } from "../types/plugin.js";

/**
 * Fluent builder for a middleware. A middleware scopes to the directory of
 * its source file and applies to every route discovered beneath it (groups
 * like `(auth-stuff)` count as directories for scoping even though they are
 * stripped from the URL).
 *
 * Usage:
 * ```ts
 * // src/routes/(auth)/middleware.ts
 * server.middleware()
 *   .describe("Enforces staff-only access")
 *   .handle(async (c, next) => {
 *     if (!c.auth.data.user.isStaff) {
 *       return c.json({ error: "forbidden" }, 403);
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
   * Optional human-readable description attached to the middleware (surfaced
   * in registration logs; not user-visible at the transport layer).
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
   * - Call `next()` to continue into the route pipeline.
   * - Return (or resolve to) a `Response` to short-circuit.
   */
  handle(
    handler: MiddlewareHandler<
      TBaseContext,
      TContextRefinementRules,
      TDefaultRouteConfig
    >,
  ): void;
}

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
