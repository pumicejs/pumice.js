import type { Context } from "hono";
import type { RouteDefinition } from "../types/route.js";
import type { Simplify } from "../types/schema.js";
import {
  isAuthenticationRequired,
  type AuthenticationRouteConfigExtension,
} from "../types/authentication.js";
import type {
  Authenticator,
  AuthState,
  ContextRefinementRule,
  ServerPlugin,
} from "../types/plugin.js";
import { createApiJsonErrorResponse } from "../http/json-envelope.js";

/**
 * Options for {@link AuthenticationPlugin}.
 *
 * @typeParam TField Name of the field where the auth state will be exposed on the route context (e.g. `"auth"` → `c.auth`).
 * @typeParam TData Shape of the authenticated user payload (e.g. `{ user: { id: string } }`).
 */
export type AuthenticationPluginOptions<
  TField extends string,
  TData,
> = {
  /**
   * Context field name where auth state will be injected.
   *
   * Defaults to `"auth"` → `c.auth`.
   *
   * @example `field: "session"` → `c.session.authenticated`, `c.session.data`
   */
  field?: TField;
  /**
   * Per-request authenticator.
   *
   * Receives the raw Hono context (before any framework validation) and
   * must return an {@link AuthState} synchronously or asynchronously.
   * Anonymous / unauthenticated requests should return
   * `{ authenticated: false }`.
   *
   * Runs at hook order `-1000`, before any other plugin hook so downstream
   * code can read `c.auth`.
   */
  authenticator: Authenticator<TData>;
};

/**
 * Narrowed {@link AuthState} for routes whose effective config has
 * `authentication.required: true`. The plugin's context refinement makes
 * `c.auth.data` non-optional in this case (the unauthenticated path is
 * already short-circuited with a 401).
 */
export type AuthenticatedAuthState<TData> = {
  authenticated: true;
  data: TData;
};

type AuthenticationRequiredContextRule<
  TField extends string,
  TData,
> = ContextRefinementRule<
  { authentication: { required: true } },
  Simplify<Record<TField, AuthenticatedAuthState<TData>>>
>;

/**
 * Wires per-request authentication into the route pipeline.
 *
 * What it adds:
 * - **Context field**: every route / middleware / procedure gets
 *   `c[field]` (default `c.auth`) typed as {@link AuthState}.
 * - **Route-config key**: `authentication: { required?: boolean }` on each
 *   route's config. When `required` is `true` (or inherited from server
 *   defaults), unauthenticated requests are rejected with a 401 envelope
 *   before validation runs.
 * - **Type refinement**: when `authentication.required: true` is the
 *   default, `c.auth.data` is typed as non-optional in handlers / procedures
 *   / middlewares (because the unauthenticated path is already short-circuited).
 *
 * The plugin registers a `beforeValidationHook` at order `-1000` so the
 * authenticator runs before every other hook and middleware — meaning
 * `c.auth` is safe to read inside ratelimit scope callbacks, custom
 * middlewares, and procedures.
 *
 * Marked `unique: true` (id: `"pumice.js/authentication"`) — registering
 * twice throws.
 *
 * @example
 * ```ts
 * server.use(AuthenticationPlugin({
 *   field: "auth",
 *   authenticator: async (c) => {
 *     const token = c.req.header("authorization")?.replace("Bearer ", "");
 *     if (!token) return { authenticated: false };
 *     const user = await verifyToken(token);
 *     return user
 *       ? { authenticated: true, data: { user } }
 *       : { authenticated: false };
 *   },
 * }));
 *
 * // Make every route protected by default; opt out per-route via .config({ authentication: { required: false } })
 * server.config({ routes: { authentication: { required: true } } });
 * ```
 */
export function AuthenticationPlugin<
  TField extends string = "auth",
  TData = unknown,
>(
  options: AuthenticationPluginOptions<TField, TData>,
): ServerPlugin<
  Simplify<Record<TField, AuthState<TData>>>,
  AuthenticationRouteConfigExtension,
  AuthenticationRequiredContextRule<TField, TData>
> {
  return {
    id: "pumice.js/authentication",
    unique: true,
    apply({ server }) {
      const field = (options.field ?? "auth") as TField;
      const routes = (server as { routes: unknown }).routes as {
        addFromCurrentFile: (
          definition: RouteDefinition<object, undefined, object, object>,
        ) => string;
      };

      const originalAddFromCurrentFile = routes.addFromCurrentFile.bind(routes);

      routes.addFromCurrentFile = (definition) => {
        return originalAddFromCurrentFile({
          ...definition,
          beforeValidationHooks: [
            ...(definition.beforeValidationHooks ?? []),
            {
              order: -1000,
              run: async (context, routeConfig) => {
                const authState = await options.authenticator(context as Context);
                (context as unknown as Record<string, unknown>)[field] = authState;

                if (
                  isAuthenticationRequired(
                    routeConfig as AuthenticationRouteConfigExtension | undefined,
                  ) &&
                  !authState.authenticated
                ) {
                  return createApiJsonErrorResponse(401, {
                    code: "UNAUTHORIZED",
                    message: "Authentication is required for this route.",
                  });
                }
              },
            },
          ],
        });
      };
    },
  };
}

export type InferAuthenticationContext<
  TField extends string,
  TData,
> = Simplify<Record<TField, AuthState<TData>>>;

export type AuthenticationHandlerContext<TData> = {
  context: Context;
  auth: AuthState<TData>;
};
