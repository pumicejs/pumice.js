import type { Context } from "hono";
import type {
  ApplyContextRefinementRules,
  ContextRefinementRule,
} from "./plugin.js";
import type { Simplify } from "./schema.js";

/**
 * Continuation passed to a middleware handler. Calling it runs the remainder
 * of the middleware chain plus the route pipeline (validation, procedures,
 * handler). The resolved value is the final `Response`.
 *
 * Not calling `next()` short-circuits the route — middleware must then return
 * a `Response` itself.
 */
export type MiddlewareNext = () => Promise<Response>;

/**
 * Context seen by middleware handlers.
 *
 * Matches the route handler context at the level of plugin-contributed
 * extensions (e.g. `c.auth`) and refinements based on the server's default
 * route config (e.g. `c.auth.data` becoming non-undefined when
 * `authentication.required === true` is the default). Per-route config
 * overrides are not yet applied at this layer.
 */
export type MiddlewareHandlerContext<
  TBaseContext extends object = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultRouteConfig extends object = {},
> = Simplify<
  Omit<Context, "json" | "body" | "error"> &
    TBaseContext &
    ApplyContextRefinementRules<TContextRefinementRules, TDefaultRouteConfig>
>;

/**
 * Middleware handler. Returning a `Response` (or resolving to one) short-
 * circuits the request; otherwise call `next()` to continue the chain.
 *
 * `(c, next) => next()` is a no-op passthrough.
 */
export type MiddlewareHandler<
  TBaseContext extends object = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultRouteConfig extends object = {},
> = (
  c: MiddlewareHandlerContext<
    TBaseContext,
    TContextRefinementRules,
    TDefaultRouteConfig
  >,
  next: MiddlewareNext,
) => Response | void | Promise<Response | void>;

/**
 * Runtime shape of a registered middleware. Produced by the middleware builder
 * and attached to routes by directory scope at registration time.
 */
export type MiddlewareDefinition<
  TBaseContext extends object = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultRouteConfig extends object = {},
> = {
  handle: MiddlewareHandler<
    TBaseContext,
    TContextRefinementRules,
    TDefaultRouteConfig
  >;
  description?: string;
  /** Absolute path of the middleware file this definition came from. */
  sourceFilePath?: string;
};

/**
 * Widest-type alias used when storing middlewares in shared collections where
 * the caller's generic parameters have been erased.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMiddlewareDefinition = MiddlewareDefinition<any, any, any>;

export type MiddlewareRegistration<
  TBaseContext extends object = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultRouteConfig extends object = {},
> = (
  definition: MiddlewareDefinition<
    TBaseContext,
    TContextRefinementRules,
    TDefaultRouteConfig
  >,
) => void;
