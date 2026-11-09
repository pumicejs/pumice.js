import { AuthenticationPlugin, RatelimitPlugin, Server } from "pumice.js";

export const server = new Server({ rootDir: import.meta.dirname })
  .use(
    AuthenticationPlugin({
      authenticator: (c) => {
        const user = c.req.header("x-user");
        return user
          ? { authenticated: true, data: { user: { id: user } } }
          : { authenticated: false };
      },
    }),
  )
  .use(RatelimitPlugin({ headers: "both" }))
  .config({ routes: { ratelimit: { limit: 2, timeframe: 60_000 } } });
