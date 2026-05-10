import type { Context, Hono } from "hono";
import type { Server } from "../structures/server.js";

type UnionToIntersection<TValue> = (
  TValue extends unknown ? (arg: TValue) => void : never
) extends (arg: infer TIntersection) => void
  ? TIntersection
  : never;

/**
 * Result returned by an {@link Authenticator}.
 *
 * `authenticated: false` means the request is anonymous (no valid credentials).
 * `authenticated: true` means credentials were verified; `data` holds the
 * application-specific payload (e.g. `{ user: { id, email } }`).
 */
export type AuthState<TData = unknown> = {
  authenticated: boolean;
  data?: TData;
};

/**
 * Per-request authenticator function used by {@link AuthenticationPlugin}.
 *
 * Receives the raw Hono context and returns an {@link AuthState} (sync or
 * async). Throwing inside an authenticator surfaces as a 500 to the client.
 */
export type Authenticator<TData = unknown> = (
  context: Context,
) => AuthState<TData> | Promise<AuthState<TData>>;

/**
 * Conditional context refinement contributed by a plugin.
 *
 * When a route's effective config matches `when` (structural subtype check),
 * the keys in `patch` are merged into the route handler's context type. This
 * is how the auth plugin makes `c.auth.data` non-optional on routes whose
 * `authentication.required` is `true`.
 *
 * Purely a type-level construct — no runtime behavior.
 */
export type ContextRefinementRule<
  TWhen extends object = object,
  TPatch extends object = object,
> = {
  when: TWhen;
  patch: TPatch;
};

export type ApplyContextRefinementRules<
  TRules,
  TConfig extends object,
> = UnionToIntersection<
  TRules extends ContextRefinementRule<infer TWhen, infer TPatch>
    ? TConfig extends TWhen
      ? TPatch
      : {}
    : {}
>;

/**
 * Parameters passed to {@link ServerPlugin.apply}.
 *
 * - `server` — the {@link Server} instance, with widened generics so plugins can
 *   safely call public methods (e.g. `getClientManifest()`).
 * - `app` — the underlying Hono app for plugins that need to mount routes
 *   directly (CORS, logger, manifest endpoint, etc.).
 */
export type ServerPluginContext = {
  server: Server<object, object, never>;
  app: Hono;
};

/**
 * Server plugin contract.
 *
 * Plugins are how the framework gets extended: each plugin can mount HTTP
 * routes, hook into the request pipeline, contribute fields to the route
 * context, contribute keys to per-route config, and refine context types
 * conditionally based on effective config.
 *
 * Lifecycle: a plugin's {@link apply} is called once when the server boots
 * (during {@link Server.listen} or `ServerBuilder.build()` follow-up). The
 * order is registration order.
 *
 * @typeParam TContext Fields the plugin adds to every route / middleware / procedure context (e.g. `{ auth: AuthState<...> }`).
 * @typeParam TRouteConfigExtensions Keys the plugin adds to per-route config (e.g. `{ authentication: { required?: boolean } }`).
 * @typeParam TContextRefinementRules Conditional refinements applied to context types when the effective config matches a `when` predicate.
 */
export type ServerPlugin<
  TContext extends object = {},
  TRouteConfigExtensions extends object = {},
  TContextRefinementRules extends ContextRefinementRule = never,
> = {
  /**
   * Wires the plugin into the server.
   *
   * Called once at boot. Typical operations:
   * - `app.use(...)` / `app.get(...)` to mount middleware or HTTP routes.
   * - Wrap `server.routes.addFromCurrentFile` to attach `beforeValidationHooks`.
   * - Read server state for diagnostics (`server.getClientManifest()`, etc.).
   *
   * For JSON endpoints registered here, use `createApiJsonSuccessResponse` and
   * `createApiJsonErrorResponse` from `pumice.js` so payloads match the framework
   * envelope (`code` / `message` / `data`, or the error shape).
   */
  apply(context: ServerPluginContext): void | Promise<void>;
  /**
   * Stable identifier set by the **plugin implementation** (not app config).
   * Required when `unique` is `true`. Conventionally namespaced as
   * `"<package>/<feature>"` (e.g. `"pumice.js/authentication"`).
   */
  id?: string;
  /**
   * When `true` on the plugin object, duplicate registrations with the same `id`
   * throw before `listen()` (or during `ServerBuilder.build()`). Only plugin authors
   * should set this; it is not part of user-facing plugin options.
   * @default false
   */
  unique?: boolean;
};
