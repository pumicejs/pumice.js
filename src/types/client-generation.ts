/**
 * Route config extension registered by {@link ClientGenerationPlugin}.
 */
export type ClientGenerationRouteConfigExtension = {
  /**
   * When `false`, this route is omitted from the manifest served by the client-generation endpoint.
   * When omitted or `true`, the route is included.
   */
  exposeClient?: boolean;
};

/**
 * Result of {@link ClientGenerationPluginOptions.authenticator}.
 */
export type ClientManifestGenerationAccess =
  | { allow: true }
  | {
      allow: false;
      status?: number;
      code?: string;
      message?: string;
    };
