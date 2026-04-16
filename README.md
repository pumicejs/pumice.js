# PumiceJS (`pumice.js`)

File-system based typed server framework for PumiceJS projects.

Built on top of [Hono](https://hono.dev/) with:

- file-based route discovery
- runtime request/response validation via [Zod](https://zod.dev/)
- strongly-typed route context (`body`, `query`, `headers`, `error`, `response`)
- plugin system (CORS, authentication, logging, client manifest generation)

## Installation

```bash
npm install pumice.js
```

## Quick Start

Create a shared server instance:

```ts
// src/app.ts
import { ServerBuilder, LoggerPlugin, CorsPlugin } from "pumice.js";

export const app = new ServerBuilder()
  .use(new LoggerPlugin())
  .use(new CorsPlugin())
  .build();
```

Boot the server:

```ts
// src/main.ts
import { app } from "./app.js";

await app.listen({ port: 3000 });
```

Define a route file:

```ts
// src/routes/users/[id].ts
import { z } from "pumice.js";
import { app } from "../../app.js";

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
});

app
  .route()
  .params(z.object({ id: z.number().int().positive() }))
  .get()
  .describe("Get one user")
  .query(z.object({ includePosts: z.coerce.boolean().optional() }))
  .response({ 200: UserSchema })
  .throws({
    404: {
      data: z.object({ userId: z.string() }),
      message: "User not found",
    },
  })
  .handle(async (c) => {
    const userId = c.params.id;
    const user = userId === 1 ? { id: "1", name: "Ada" } : null;

    if (!user) {
      throw c.error({ status: 404, data: { userId: String(userId) } });
    }

    return c.returns(user);
  });
```

## File-Based Routing

By default, routes are discovered under `src/routes`.

- `src/routes/index.ts` -> `/`
- `src/routes/users/index.ts` -> `/users`
- `src/routes/users/[id].ts` -> `/users/:id`
- `src/routes/posts/route.ts` -> `/posts`

You can change route discovery behavior with:

- `.rootDir(...)` (defaults to `<cwd>/src`)
- `.basePath(...)` (defaults to `routes`)

## Validation and Response Model

When you define schemas:

- request `body`, `query`, and `headers` are parsed and validated
- route `params` are parsed and validated via `route().params(...)`
- successful payloads are validated against `response`
- thrown API errors are validated against `throws`

Route params are received as strings and numeric params are coerced under the hood. When params validation fails (for example `id=abc` with `z.number()`), the framework returns a `400` response with `code: "VALIDATION_ERROR"`.

Successful JSON responses follow the framework envelope:

```json
{
  "code": "SUCCESS",
  "message": "OK",
  "data": {}
}
```

For typed explicit responses, use `c.response(...)`.
For typed errors, use `c.error(...)`.

## Plugins

### Built-in Plugins

- `CorsPlugin` - wraps Hono CORS middleware
- `LoggerPlugin` - request/response lifecycle logs with duration
- `AuthenticationPlugin` - injects auth state into route context and can enforce `config({ authentication: { required: true } })`
- `ClientGenerationPlugin` - serves a route manifest endpoint (default `GET /@client`)

### Authentication Example

```ts
import { AuthenticationPlugin, ServerBuilder } from "pumice.js";

const app = new ServerBuilder()
  .use(
    AuthenticationPlugin({
      field: "auth",
      authenticator: async (c) => {
        const token = c.req.header("authorization");
        if (!token) return { authenticated: false };
        return { authenticated: true, data: { token } };
      },
    }),
  )
  .build();
```

Then on protected routes:

```ts
app
  .route()
  .get()
  .config({ authentication: { required: true } })
  .handle((c) => {
    if (!c.auth.authenticated) {
      throw c.error({ status: 401 });
    }
    return c.returns({ ok: true });
  });
```

## Client Manifest

`ClientGenerationPlugin` exposes a JSON manifest of discovered routes (with schema metadata converted to JSON Schema) for client codegen tooling.

Use route config to control exposure:

```ts
app.route().get().config({ exposeClient: false }).handle(() => ({ internal: true }));
```

## API Exports

Primary exports:

- `Server`
- `ServerBuilder`
- `CorsPlugin`
- `AuthenticationPlugin`
- `LoggerPlugin`
- `ClientGenerationPlugin`
- `z`
- `createApiJsonSuccessResponse`
- `createApiJsonErrorResponse`

## Repository

- GitHub: [pumicejs/pumice.js](https://github.com/pumicejs/pumice.js)
