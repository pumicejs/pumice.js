import {
  AuthenticationPlugin,
  CorsPlugin,
  LoggerPlugin,
  Server,
} from "pumice.js";

export const logLines: string[] = [];

export const server = new Server({ rootDir: import.meta.dirname })
  .use(
    new LoggerPlugin({
      logger: {
        info: (line: string) => logLines.push(line),
        error: (line: string) => logLines.push(line),
      },
    }),
  )
  .use(
    new CorsPlugin({
      origin: ["https://app.example"],
      allowHeaders: ["Authorization", "Content-Type"],
    }),
  )
  .use(
    AuthenticationPlugin({
      field: "session",
      authenticator: (c) => {
        const header = c.req.header("authorization");
        if (header === "Bearer explode") {
          throw new Error("session store down");
        }
        return header === "Bearer good"
          ? { authenticated: true, data: { user: { id: "u1" } } }
          : { authenticated: false };
      },
    }),
  )
  .config({ routes: { authentication: { required: true } } });
