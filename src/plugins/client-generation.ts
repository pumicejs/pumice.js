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

export type ClientGenerationPluginOptions = {
  /**
   * Manifest HTTP path.
   * @default "/@client"
   */
  path?: string;
  /**
   * Optional gate invoked for every manifest request before the payload is built.
   * Use for API keys, internal tokens, or allowlists for codegen tools.
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
 * Serves a filtered {@link ClientManifest} at `GET /@client` (configurable) and extends
 * route config with {@link ClientGenerationRouteConfigExtension} (`exposeClient`, etc.).
 * Responses use the shared JSON envelope helpers from `pumice.js`.
 *
 * Example:
 * `use(ClientGenerationPlugin({ authenticator: async (c) => ... }))`
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
