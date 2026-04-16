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

export type AuthenticationPluginOptions<
  TField extends string,
  TData,
> = {
  /**
   * Context field name where auth state will be injected.
   *
   * Example: `field: "user"` gives you `c.user` in route handlers.
   */
  field?: TField;
  /**
   * Authenticator called per request when plugin is configured.
   */
  authenticator: Authenticator<TData>;
};

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
 * Registers request authentication and context injection.
 *
 * Example:
 * `use(AuthenticationPlugin({ field: "user", authenticator }))`
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
