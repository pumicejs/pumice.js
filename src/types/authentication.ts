/**
 * Authentication policy for a route.
 *
 * - `required: true` means authenticated requests only (protected route)
 * - `required: false` means authentication is optional (public route)
 */
export type RouteAuthenticationConfig = {
  /**
   * Whether authentication is required for the route.
   *
   * Leave undefined to inherit from server/route defaults.
   */
  required?: boolean;
};

export type AuthenticationRouteConfigExtension = {
  authentication?: RouteAuthenticationConfig;
};

export function isAuthenticationRequired(
  config: AuthenticationRouteConfigExtension | undefined,
): boolean {
  return config?.authentication?.required ?? false;
}
