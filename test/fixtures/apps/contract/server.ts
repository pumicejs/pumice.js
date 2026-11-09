import {
  AuthenticationPlugin,
  ClientGenerationPlugin,
  DocsPlugin,
  RatelimitPlugin,
  Server,
} from "pumice.js";

/**
 * The contract app: one route for every shape that reaches the client and
 * docs manifests. `npm run fixtures:contract` writes its manifests to
 * fixtures/contract/, which the client and docs repos test against.
 */
export const server = new Server({ rootDir: import.meta.dirname })
  .use(
    AuthenticationPlugin({
      authenticator: (c) =>
        c.req.header("authorization") === "Bearer test"
          ? { authenticated: true, data: { user: { id: "u1" } } }
          : { authenticated: false },
    }),
  )
  .use(RatelimitPlugin())
  .use(ClientGenerationPlugin())
  .use(
    DocsPlugin({
      tags: [
        { name: "users", label: "Users", color: "blue" },
        { name: "beta", description: "May change" },
        { name: "media", label: "Media" },
      ],
      groups: [
        {
          name: "accounts",
          label: "Accounts",
          order: 1,
          match: { pathPrefix: "/users" },
        },
        {
          name: "media",
          label: "Media",
          parent: "accounts",
          match: { tag: "media" },
        },
        { name: "ops", label: "Operations", order: 2 },
      ],
      onUnknownTag: "ignore",
      onUnknownGroup: "ignore",
    }),
  )
  .config({
    routes: {
      authentication: { required: true },
      ratelimit: { limit: 100, timeframe: 60_000 },
    },
  });
