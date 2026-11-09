import { describe, expect, it } from "vitest";
import {
  buildApiJsonSuccessBody,
  createApiJsonErrorResponse,
  createApiJsonSuccessResponse,
  InMemoryRatelimitStore,
} from "pumice.js";
import { filePathToUrlPath } from "../src/parser.js";
import { mergeRouteConfig } from "../src/config/routes.js";
import { RATELIMIT_ALGORITHMS } from "../src/plugins/ratelimit/algorithms.js";
import { ApiError, getStatusMessage } from "../src/errors/api.js";
import { resolveBodyLimit } from "../src/http/body-limit.js";
import { createRouteBuilder } from "../src/builders/route.js";

describe("filePathToUrlPath", () => {
  it.each([
    ["routes/route.ts", "/"],
    ["routes/index.js", "/"],
    ["routes/users/route.ts", "/users"],
    ["routes/users/search.ts", "/users/search"],
    ["routes/users/[id]/route.ts", "/users/:id"],
    ["routes/users/[id].ts", "/users/:id"],
    ["routes/(admin)/settings/index.ts", "/settings"],
    ["routes\\win\\[x]\\route.ts", "/win/:x"],
  ])("%s → %s", (file, url) => {
    expect(filePathToUrlPath(file)).toBe(url);
  });

  it("honours a nested base path", () => {
    expect(
      filePathToUrlPath("src/api/v1/users/route.ts", { basePath: "api/v1" }),
    ).toBe("/users");
  });
});

describe("mergeRouteConfig", () => {
  it("merges plain objects deeply, replaces everything else, keeps the base for undefined", () => {
    const merged = mergeRouteConfig<Record<string, unknown>>(
      { auth: { required: true, roles: ["a"] }, limit: 1, keep: "x" },
      { auth: { roles: ["b"] }, limit: undefined, extra: true },
    );
    expect(merged).toEqual({
      auth: { required: true, roles: ["b"] },
      limit: 1,
      keep: "x",
      extra: true,
    });
  });
});

describe("resolveBodyLimit", () => {
  const MiB = 1024 * 1024;
  it("defaults to 1 MiB and honours an explicit value or false", () => {
    expect(resolveBodyLimit(undefined, undefined)).toBe(MiB);
    expect(
      resolveBodyLimit({ bodyLimit: 10 }, { file: { maxSize: 5 * MiB } }),
    ).toBe(10);
    expect(resolveBodyLimit({ bodyLimit: false }, undefined)).toBe(false);
  });
  it("raises the default to what declared uploads need", () => {
    expect(resolveBodyLimit({}, { file: { maxSize: 5 * MiB } })).toBe(
      5 * MiB + 64 * 1024,
    );
    expect(resolveBodyLimit({}, { files: { maxSize: MiB, maxCount: 3 } })).toBe(
      3 * MiB + 64 * 1024,
    );
    expect(
      resolveBodyLimit({}, { files: { totalMaxSize: 2 * MiB, maxSize: 9 } }),
    ).toBe(2 * MiB + 64 * 1024);
    expect(resolveBodyLimit({}, { file: { maxSize: 10 } })).toBe(MiB);
  });
});

describe("ratelimit algorithms", () => {
  const base = { limit: 2, timeframeMs: 1000, cost: 1, consume: true };
  type Record = Parameters<
    (typeof RATELIMIT_ALGORITHMS)["fixed-window"]["evaluate"]
  >[0]["record"];

  function run(
    name: keyof typeof RATELIMIT_ALGORITHMS,
    times: number[],
    extra = {},
  ) {
    let record: Record = undefined;
    return times.map((now) => {
      const result = RATELIMIT_ALGORITHMS[name].evaluate({
        ...base,
        ...extra,
        record,
        now,
      });
      record = result.newRecord;
      return result.allowed;
    });
  }

  it("fixed window resets at the window boundary", () => {
    expect(run("fixed-window", [0, 10, 20, 1001])).toEqual([
      true,
      true,
      false,
      true,
    ]);
  });

  it("sliding window counts requests within the trailing window", () => {
    expect(run("sliding-window", [0, 10, 20])).toEqual([true, true, false]);
    expect(run("sliding-window", [0, 10, 2100])).toEqual([true, true, true]);
  });

  it("token bucket allows the burst, then refills over time", () => {
    expect(run("token-bucket", [0, 0, 0, 0], { burst: 3 })).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(run("token-bucket", [0, 0, 0, 2000], { burst: 3 }).at(-1)).toBe(
      true,
    );
  });

  it("leaky bucket drains over time", () => {
    expect(run("leaky-bucket", [0, 0, 0, 1000])).toEqual([
      true,
      true,
      false,
      true,
    ]);
  });
});

describe("InMemoryRatelimitStore", () => {
  it("forgets records after they expire, unless blocked", async () => {
    const store = new InMemoryRatelimitStore();
    const past = Date.now() - 1;
    await store.set("a", { data: 1, expiresAt: past });
    await store.set("b", {
      data: 1,
      expiresAt: past,
      blockedUntil: Date.now() + 60_000,
    });
    expect(await store.get("a")).toBeUndefined();
    expect(await store.get("b")).toMatchObject({ data: 1 });
    await store.delete("b");
    expect(await store.get("b")).toBeUndefined();
  });
});

describe("errors and envelopes", () => {
  it("builds ApiError from a status or an init object, with issues", () => {
    const error = new ApiError({
      status: 404,
      code: "USER_NOT_FOUND",
    }).addIssue({
      message: "no such id",
      path: ["params", "id"],
    });
    expect(error).toMatchObject({
      status: 404,
      code: "USER_NOT_FOUND",
      message: "Not Found",
    });
    expect(error.issues).toHaveLength(1);
    expect(new ApiError(418).message).toBe("I'm a Teapot");
    expect(getStatusMessage(799)).toBe("799");
  });

  it("builds the success and error envelopes", async () => {
    expect(buildApiJsonSuccessBody({ a: 1 }, 201)).toEqual({
      code: "SUCCESS",
      message: "Created",
      data: { a: 1 },
    });
    const ok = createApiJsonSuccessResponse([1], {
      status: 202,
      headers: { "x-a": "1" },
    });
    expect(ok.status).toBe(202);
    expect(ok.headers.get("x-a")).toBe("1");
    expect(await ok.json()).toEqual({
      code: "SUCCESS",
      message: "Accepted",
      data: [1],
    });
    const error = createApiJsonErrorResponse(400, {
      code: "BAD",
      message: "Bad",
      issues: [],
    });
    expect(await error.json()).toEqual({ code: "BAD", message: "Bad" });
  });
});

describe("route builder chain", () => {
  const builder = () => createRouteBuilder(() => "/x");

  it("refuses a body or file on GET at runtime too", () => {
    expect(() =>
      (builder().get() as unknown as { schema(s: object): unknown }).schema({
        body: {} as never,
      }),
    ).toThrow("GET routes cannot define a request body schema.");
  });

  it("refuses file and files on one route", () => {
    expect(() => builder().post().file({}).files({})).toThrow(/choose one/);
  });

  it("requires an HTTP method before describe() and handle()", () => {
    expect(() =>
      (builder() as unknown as { describe(d: string): unknown }).describe("x"),
    ).toThrow(/call an HTTP method before \.describe/);
  });

  it("requires handle() before the next method", () => {
    const chain = builder().get() as unknown as { post(): unknown };
    expect(() => chain.post()).toThrow(/must be followed by \.handle/);
  });
});
