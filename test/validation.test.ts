import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { call } from "./helpers.js";
import { server } from "./fixtures/apps/validation/server.js";

beforeAll(async () => {
  await server.load();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const post = (json: unknown) =>
  call(server, "/items", { method: "POST", json });

describe("request validation", () => {
  it("parses a valid JSON body and applies defaults", async () => {
    const res = await post({ name: "a" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      code: "SUCCESS",
      message: "OK",
      data: { name: "a", count: 1 },
    });
  });

  it("rejects an invalid body with VALIDATION_ERROR and the Zod issues", async () => {
    const res = await post({ name: "", count: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(
      res.body.data.body.map((i: { path: string[] }) => i.path[0]),
    ).toEqual(["name", "count"]);
  });

  it("reports malformed JSON as invalid_body", async () => {
    const res = await call(server, "/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{nope",
    });
    expect(res.status).toBe(400);
    expect(res.body.data.body[0]).toMatchObject({ code: "invalid_body" });
  });

  it("explains a double-encoded JSON body", async () => {
    const res = await call(server, "/items", {
      method: "POST",
      json: JSON.stringify({ name: "a" }),
    });
    expect(res.status).toBe(400);
    expect(res.body.data.body[0].message).toMatch(/JSON string instead/);
  });

  it("coerces query strings to the numbers and booleans the schema wants", async () => {
    const res = await call(server, "/search?q=x&page=2&exact=true&either=3");
    expect(res.body.data).toEqual({
      q: "x",
      page: 2,
      exact: true,
      either: "3",
    });
  });

  it("rejects a query that doesn't coerce", async () => {
    const res = await call(server, "/search?q=x&page=two");
    expect(res.status).toBe(400);
    expect(res.body.data.query[0].path).toEqual(["page"]);
  });

  it("coerces path params", async () => {
    const res = await call(server, "/typed/42/false");
    expect(res.body.data).toEqual({ n: 42, flag: false });
    expect((await call(server, "/typed/x/true")).status).toBe(400);
  });

  it("validates headers by their lower-case names", async () => {
    expect((await call(server, "/headers")).status).toBe(400);
    const res = await call(server, "/headers", {
      headers: { "X-Api-Key": "abcd" },
    });
    expect(res.body.data).toEqual({ key: "abcd" });
  });

  it.fails(
    "keeps every value of a repeated query key for an array schema (REVIEW §1.5)",
    async () => {
      const res = await call(server, "/pipe?tag=a&tag=b");
      expect(res.status).toBe(200);
      expect(res.body.data.tag).toEqual(["a", "b"]);
    },
  );

  it.fails(
    "doesn't coerce a value the schema's input wants as a string (REVIEW §1.5)",
    async () => {
      const res = await call(server, "/pipe?page=2");
      expect(res.status).toBe(200);
      expect(res.body.data.page).toBe(2);
    },
  );

  it.fails("refuses a JSON body sent as text/plain (REVIEW §2.3)", async () => {
    const res = await call(server, "/items", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ name: "csrf" }),
    });
    expect(res.status).toBe(415);
  });

  it.fails(
    "accepts an empty body when the body schema is optional (REVIEW §1.12)",
    async () => {
      const res = await call(server, "/optional-body", { method: "POST" });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ note: null });
    },
  );
});

describe("responses", () => {
  it("wraps a plain return value in the success envelope", async () => {
    expect((await post({ name: "plain", count: 2 })).body.data).toEqual({
      name: "plain",
      count: 2,
    });
  });

  it("sends c.response() with its status", async () => {
    const res = await post({ name: "created" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      code: "SUCCESS",
      message: "Created",
      data: { name: "created", count: 1 },
    });
  });

  it("passes a returned Response through untouched", async () => {
    const res = await post({ name: "raw" });
    expect(res.status).toBe(202);
    expect(res.body).toBe("raw body");
  });

  it("wraps c.json() payloads in the envelope too", async () => {
    expect((await call(server, "/via-json")).body).toEqual({
      code: "SUCCESS",
      message: "OK",
      data: { via: "json" },
    });
  });

  it("doesn't validate or strip the response against .response() — it is types and docs only (REVIEW §1.9)", async () => {
    const res = await call(server, "/leaky-response");
    expect(res.body.data).toEqual({ id: 1, passwordHash: "secret" });
  });
});

describe("thrown errors", () => {
  it("sends a declared status with its declared message", async () => {
    const res = await post({ name: "dup" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: "API_ERROR",
      message: "An item with this name already exists",
    });
  });

  it("sends declared error data", async () => {
    const res = await post({ name: "reject" });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      code: "API_ERROR",
      message: "Rejected",
      data: { reason: "rate_limited" },
    });
  });

  it("refuses error data that breaks the declared schema with a 500", async () => {
    const res = await post({ name: "bad-data" });
    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Thrown error payload validation failed.");
  });

  it("resolves the message of a code-mapped status", async () => {
    const res = await post({ name: "owner" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ code: "NOT_OWNER", message: "Not your item" });
  });

  it("requires a code for a code-mapped status", async () => {
    const res = await post({ name: "no-code" });
    expect(res.status).toBe(500);
    expect(res.body.data.allowedCodes).toEqual(["NOT_OWNER", "LOCKED"]);
  });

  it("turns a thrown Error into a generic 500 and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ name: "crash" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      code: "INTERNAL_ERROR",
      message: "An error occurred in the handler.",
    });
    expect(JSON.stringify(res.body)).not.toContain("database exploded");
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[RouteError\] POST \/items -> 500 INTERNAL_ERROR/,
      ),
      expect.objectContaining({ message: "database exploded" }),
    );
  });

  it("turns a thrown 5xx number into a generic 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ name: "unavailable" });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL_ERROR");
  });

  it.fails(
    "sends an undeclared 4xx as itself instead of a 500 (REVIEW §1.6)",
    async () => {
      const res = await post({ name: "undeclared" });
      expect(res.status).toBe(404);
    },
  );
});
