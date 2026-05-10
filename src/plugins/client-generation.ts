import type { Context } from "hono";
import type { Server as ServerInstance } from "../structures/server.js";
import {
  createApiJsonErrorResponse,
  createApiJsonSuccessResponse,
} from "../http/json-envelope.js";
import type { ServerPlugin } from "../types/plugin.js";
import type { RouteMethod } from "../types/route.js";
import {
  CLIENT_MANIFEST_METHOD_ORDER,
  type ClientManifest,
  type ClientManifestMethod,
  type ClientManifestRoute,
} from "../client-manifest.js";
import type {
  ClientGenerationRouteConfigExtension,
  ClientManifestGenerationAccess,
} from "../types/client-generation.js";

/**
 * Options for {@link ClientGenerationPlugin}.
 */
export type ClientGenerationPluginOptions = {
  /**
   * Manifest HTTP path.
   *
   * The plugin registers a single `GET <path>` handler. Defaults to `"/@client"`
   * (the leading `@` keeps it out of the way of normal routes).
   */
  path?: string;
  /**
   * Optional gate invoked for every manifest request before the payload is built.
   *
   * Use for API keys, internal tokens, or allowlists for codegen tools.
   * Returning `{ allow: false }` short-circuits with a JSON error envelope
   * (defaults: 403 / `FORBIDDEN`). Returning `{ allow: true }` lets the
   * manifest through unchanged.
   *
   * @example
   * ```ts
   * authenticator: async (c) => {
   *   const token = c.req.header("x-internal-token");
   *   return token === process.env.CLIENT_GEN_TOKEN
   *     ? { allow: true }
   *     : { allow: false, status: 401, code: "UNAUTHORIZED", message: "Bad token" };
   * }
   * ```
   */
  authenticator?: (
    context: Context,
  ) => ClientManifestGenerationAccess | Promise<ClientManifestGenerationAccess>;
};

function filterManifestByExposeClient(manifest: ClientManifest): ClientManifest {
  const routes: ClientManifestRoute[] = [];

  for (const route of manifest.routes) {
    const methods: Partial<Record<RouteMethod, ClientManifestMethod>> = {};
    for (const method of CLIENT_MANIFEST_METHOD_ORDER) {
      const entry = route.methods[method];
      if (entry !== undefined && entry.effectiveConfig["exposeClient"] !== false) {
        methods[method] = entry;
      }
    }
    if (Object.keys(methods).length > 0) {
      routes.push({ ...route, methods });
    }
  }

  return { ...manifest, routes };
}

/**
 * Exposes the running app's route manifest as a JSON endpoint for client codegen.
 *
 * What it adds:
 * - **HTTP route**: registers `GET <path>` (default `/@client`) returning the
 *   filtered {@link ClientManifest} — every route's path, params, schemas
 *   (Zod → JSON Schema), per-method descriptors / merged config, and framework
 *   metadata (name, version, server-listening timestamp).
 * - **Route-config key**: `exposeClient?: boolean`. Set per-route or per-method
 *   to `false` to hide the route from the generated manifest (still served
 *   normally, just not advertised). Defaults to included.
 * - **Optional authenticator**: gate access behind a token / allowlist for
 *   internal-only manifests.
 *
 * Marked `unique: true` (id: `"pumice.js/client-generation"`) — registering
 * twice throws.
 *
 * @example
 * ```ts
 * // expose at the default /@client, no auth (internal network only)
 * server.use(ClientGenerationPlugin());
 *
 * // hide a route from codegen
 * server.route().post().config({ exposeClient: false }).handle(...);
 *
 * // gated manifest
 * server.use(ClientGenerationPlugin({
 *   path: "/__codegen__/manifest",
 *   authenticator: async (c) => c.req.header("x-codegen-token") === SECRET
 *     ? { allow: true }
 *     : { allow: false, status: 401 },
 * }));
 * ```
 */
export function ClientGenerationPlugin(
  options: ClientGenerationPluginOptions = {},
): ServerPlugin<{}, ClientGenerationRouteConfigExtension, never> {
  return {
    id: "pumice.js/client-generation",
    unique: true,
    apply({ server, app }) {
      const path = options.path ?? "/@client";
      const serverInstance = server as unknown as ServerInstance;

      app.get(path, async (context) => {
        if (options.authenticator) {
          const access = await options.authenticator(context);
          if (!access.allow) {
            const status = access.status ?? 403;
            return createApiJsonErrorResponse(status, {
              code: access.code ?? "FORBIDDEN",
              message:
                access.message ??
                "You are not allowed to access the client manifest.",
            });
          }
        }

        const manifest = serverInstance.getClientManifest();
        const payload = filterManifestByExposeClient(manifest);

        return createApiJsonSuccessResponse(payload);
      });
    },
  };
}
