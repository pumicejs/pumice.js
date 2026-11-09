import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call } from "./helpers.js";
import { server } from "./fixtures/apps/routing/server.js";
import { counters, trace } from "./fixtures/apps/routing/trace.js";

beforeAll(async () => {
  await server.load();
});

beforeEach(() => {
  trace.length = 0;
});

describe("file-system routing", () => {
  it("serves the root route.ts at /", async () => {
    const res = await call(server, "/");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: "SUCCESS", message: "OK", data: "root" });
  });

  it("maps a plain named file to a sub-path", async () => {
    expect((await call(server, "/users/search")).body.data).toEqual({
      search: true,
    });
  });

  it("matches a static segment before a dynamic one at the same depth", async () => {
    expect((await call(server, "/users/me")).body.data).toEqual({ me: true });
    expect((await call(server, "/users/7")).body.data).toEqual({ id: 7 });
  });

  it("strips (group) directories from the URL and treats index.ts like route.ts", async () => {
    const res = await call(server, "/settings", {
      headers: { "x-admin": "yes" },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ settings: true });
  });

  it("chains several methods for one path in one file", async () => {
    expect((await call(server, "/users")).body.data).toEqual({ list: true });
    expect(
      (await call(server, "/users", { method: "POST" })).body.data,
    ).toEqual({ created: true });
  });

  it("exposes nested dynamic params", async () => {
    expect((await call(server, "/posts/9/comments")).body.data).toEqual({
      postId: "9",
    });
  });

  it("answers unknown paths and methods with the 404 envelope", async () => {
    const res = await call(server, "/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "NOT_FOUND", message: "Not Found" });
    expect((await call(server, "/users/me", { method: "DELETE" })).status).toBe(
      404,
    );
  });

  it("returns the registered URL paths from load()", async () => {
    const paths = await server.load();
    expect(paths).toEqual(
      expect.arrayContaining(["/", "/users", "/users/:id"]),
    );
  });

  it("registers a route file under its own path even when another route file imports it (REVIEW §1.2)", async () => {
    const post = await call(server, "/posts/1");
    expect(post.status).toBe(200);
    expect(post.body.data).toEqual({ from: "posts/[postId]" });

    const board = await call(server, "/boards", { method: "POST" });
    expect(board.body.data).toMatchObject({ from: "boards" });
    expect((await call(server, "/boards")).status).toBe(404);
  });
});

describe("middleware", () => {
  it("runs outermost first, in registration order within a directory, and unwinds", async () => {
    await call(server, "/users");
    expect(trace).toEqual([
      "root:before",
      "users-a",
      "users-b",
      "handler:/users",
      "root:after",
    ]);
  });

  it("scopes a middleware to its directory and below", async () => {
    await call(server, "/");
    expect(trace).toEqual(["root:before", "root:after"]);
  });

  it("short-circuits when a middleware returns a Response", async () => {
    const res = await call(server, "/settings");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ code: "FORBIDDEN", message: "Admins only." });
  });

  it("maps a 4xx thrown in a middleware to the error envelope", async () => {
    const res = await call(server, "/mw-stop");
    expect(res.status).toBe(418);
    expect(res.body).toMatchObject({ code: "API_ERROR" });
  });

  it("runs the handler once when a middleware awaits next() without returning (REVIEW §1.1)", async () => {
    const before = counters.wrapHandler;
    const res = await call(server, "/mw-wrap", { method: "POST" });
    expect(counters.wrapHandler - before).toBe(1);
    expect(res.body).toEqual({
      code: "SUCCESS",
      message: "OK",
      data: { hits: counters.wrapHandler },
    });
  });

  it("continues the chain once when a middleware returns without calling next()", async () => {
    const before = counters.voidHandler;
    const res = await call(server, "/mw-void", { method: "POST" });
    expect(counters.voidHandler - before).toBe(1);
    expect(res.status).toBe(200);
  });
});
