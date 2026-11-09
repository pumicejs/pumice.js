import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call } from "./helpers.js";
import { server } from "./fixtures/apps/procedures/server.js";
import { calls } from "./fixtures/apps/procedures/lib/procedures.js";

beforeAll(async () => {
  await server.load();
});

beforeEach(() => {
  calls.length = 0;
});

const as = (user: string, method = "GET") => ({
  method,
  headers: { "x-user": user },
});

describe("procedures", () => {
  it("contributes to c.procedures and merges its params into the route's", async () => {
    const res = await call(server, "/posts/2", as("ann"));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ title: "Bob's post", postId: 2 });
  });

  it("passes the use-site config, relaxing reads but not writes", async () => {
    expect((await call(server, "/posts/2", as("ann", "DELETE"))).status).toBe(
      403,
    );
    const own = await call(server, "/posts/1", as("ann", "DELETE"));
    expect(own.body.data).toEqual({ deleted: 1, audited: true });
  });

  it("runs only on the methods given in applyOnMethods, in attachment order", async () => {
    await call(server, "/posts/1", as("ann"));
    expect(calls).toEqual(["post:1"]);
    calls.length = 0;
    await call(server, "/posts/1", as("ann", "DELETE"));
    expect(calls).toEqual(["post:1", "audit"]);
  });

  it("answers a thrown 4xx with the error envelope", async () => {
    const res = await call(server, "/posts/99", as("ann"));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "API_ERROR", message: "Not Found" });
  });

  it("validates the procedure's params", async () => {
    expect((await call(server, "/posts/abc", as("ann"))).status).toBe(400);
  });

  it("turns an Error in a procedure into a generic 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call(server, "/broken/1", as("ann"));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      code: "INTERNAL_ERROR",
      message: "An error occurred in a route procedure.",
    });
    expect(log.mock.calls[0]?.[0]).toMatch(
      /^\[ProcedureError\] GET \/broken\/1/,
    );
    log.mockRestore();
  });

  it.fails(
    "keeps a procedure's 404 on a route that declares other throws (REVIEW §1.6)",
    async () => {
      const res = await call(server, "/strict/99", as("ann", "PATCH"));
      expect(res.status).toBe(404);
    },
  );
});
