import { readFile, writeFile, mkdir } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { ClientGenerationPlugin, DocsPlugin, Server } from "pumice.js";
import { call } from "./helpers.js";
import { server } from "./fixtures/apps/contract/server.js";

const FIXTURES = new URL("../fixtures/contract/", import.meta.url);
const UPDATE = process.env.UPDATE_CONTRACT_FIXTURES === "1";

/** Pins the fields that change on every request or release. */
function stable<T extends { meta: Record<string, unknown> }>(manifest: T): T {
  return {
    ...manifest,
    meta: {
      ...manifest.meta,
      generatedAt: "2026-01-01T00:00:00.000Z",
      ...("listeningSince" in manifest.meta
        ? { listeningSince: undefined }
        : {}),
      framework: { name: "pumice.js", version: "0.0.0-fixture" },
    },
  };
}

let clientManifest: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- read as JSON
let docsManifest: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- read as JSON

beforeAll(async () => {
  await server.load();
  clientManifest = stable((await call(server, "/@client")).body.data);
  docsManifest = stable((await call(server, "/@docs")).body.data);
});

async function compareOrWrite(name: string, manifest: unknown): Promise<void> {
  const url = new URL(name, FIXTURES);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (UPDATE) {
    await mkdir(FIXTURES, { recursive: true });
    await writeFile(url, text);
    return;
  }
  const committed = await readFile(url, "utf8").catch(() => "");
  expect(
    committed,
    `fixtures/contract/${name} is stale: run npm run fixtures:contract and update the client and docs repos (docs/development/contract.md)`,
  ).toBe(text);
}

describe("contract fixtures", () => {
  it("client-manifest.json matches what the contract app serves", async () => {
    await compareOrWrite("client-manifest.json", clientManifest);
  });

  it("docs-manifest.json matches what the contract app serves", async () => {
    await compareOrWrite("docs-manifest.json", docsManifest);
  });
});

describe("ClientGenerationPlugin", () => {
  const paths = () =>
    clientManifest.routes.map((route: { path: string }) => route.path);

  it("serves manifest version 3 with every exposed route", () => {
    expect(clientManifest.version).toBe(3);
    expect(paths()).toEqual([
      "/admin/jobs",
      "/orgs/:orgId/boards",
      "/orgs/:orgId/boards/:boardId",
      "/orgs/:orgId/logo",
      "/orgs/:orgId/members",
      "/ping",
      "/users",
      "/users/:userId",
      "/users/:userId/avatar",
      "/users/:userId/photos",
    ]);
  });

  it("leaves out routes with exposeClient: false", () => {
    expect(paths()).not.toContain("/health");
  });

  it("serializes the route contract as JSON Schema", () => {
    const users = clientManifest.routes.find(
      (route: { path: string }) => route.path === "/users",
    );
    expect(users.methods.post.schema.throws).toEqual({
      409: {
        kind: "descriptor",
        message: "Email already registered",
      },
      422: {
        kind: "schema",
        jsonSchema: expect.objectContaining({ type: "object" }),
      },
    });
    expect(users.methods.post.effectiveConfig.bodyLimit).toBe(1024 * 1024);
    expect(users.methods.get.effectiveConfig).not.toHaveProperty("bodyLimit");
  });

  it.fails(
    "describes request bodies as the client sends them, so defaults are optional (REVIEW §1.10)",
    () => {
      const users = clientManifest.routes.find(
        (route: { path: string }) => route.path === "/users",
      );
      expect(users.methods.post.schema.body.required).toEqual([
        "name",
        "email",
      ]);
    },
  );

  it.fails("includes the params a procedure contributes (REVIEW §1.11)", () => {
    const user = clientManifest.routes.find(
      (route: { path: string }) => route.path === "/users/:userId",
    );
    expect(user.params?.properties).toHaveProperty("userId");
  });

  it.fails(
    "doesn't publish source file paths or hook counts (REVIEW §2.4)",
    () => {
      const text = JSON.stringify(clientManifest);
      expect(text).not.toContain("routeFile");
      expect(text).not.toContain("beforeValidationHooksCount");
    },
  );

  it("gates the manifest behind its authenticator", async () => {
    const gated = new Server({
      rootDir: new URL("./fixtures/apps/empty/", import.meta.url).pathname,
    }).use(
      ClientGenerationPlugin({
        path: "/__codegen",
        authenticator: (c) =>
          c.req.header("x-codegen-token") === "secret"
            ? { allow: true }
            : { allow: false, status: 401, code: "UNAUTHORIZED" },
      }),
    );
    expect((await call(gated, "/__codegen")).status).toBe(401);
    const res = await call(gated, "/__codegen", {
      headers: { "x-codegen-token": "secret" },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.routes).toEqual([]);
  });
});

describe("DocsPlugin", () => {
  type Group = {
    name: string;
    routes: Array<{ path: string; method: string }>;
    children: Group[];
  };
  const groups = (): Group[] => docsManifest.groups;
  const find = (name: string, list = groups()): Group | undefined => {
    for (const group of list) {
      if (group.name === name) return group;
      const child = find(name, group.children);
      if (child) return child;
    }
    return undefined;
  };
  const routesOf = (name: string) =>
    find(name)?.routes.map((route) => `${route.method} ${route.path}`);

  it("groups routes by prefix, with tag-matched child groups first", () => {
    expect(routesOf("media")).toEqual([
      "put /orgs/:orgId/logo",
      "put /users/:userId/avatar",
      "post /users/:userId/photos",
    ]);
    // Sorted by docs.order (unset counts as 0), then path, then method.
    expect(routesOf("accounts")).toEqual([
      "post /users",
      "get /users/:userId",
      "delete /users/:userId",
      "get /users",
    ]);
    expect(find("accounts")?.children.map((child) => child.name)).toEqual([
      "media",
    ]);
  });

  it("documents routes hidden from the client, and leaves out docs.hidden ones", () => {
    expect(routesOf("ops")).toEqual(["get /health"]);
    expect(JSON.stringify(docsManifest)).not.toContain(
      '"method":"post","path":"/admin/jobs"',
    );
  });

  it("carries tags, summaries, examples and deprecation", () => {
    const post = find("accounts")?.routes.find(
      (route) => route.method === "post",
    ) as unknown as Record<string, unknown>;
    expect(post.tags).toEqual(["users", "beta"]);
    expect(post.examples).toHaveLength(1);
    expect(docsManifest.tags.map((tag: { name: string }) => tag.name)).toEqual([
      "users",
      "beta",
      "media",
    ]);
  });

  it.fails("keeps a route whose docs.group isn't declared (REVIEW §3)", () => {
    expect(JSON.stringify(docsManifest.groups)).toContain(
      '"path":"/admin/jobs"',
    );
  });

  it("serves at a custom path behind its authenticator", async () => {
    const gated = new Server({
      rootDir: new URL("./fixtures/apps/empty/", import.meta.url).pathname,
    }).use(
      DocsPlugin({
        path: "/__docs",
        authenticator: () => ({ allow: false }),
      }),
    );
    const res = await call(gated, "/__docs");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });
});
