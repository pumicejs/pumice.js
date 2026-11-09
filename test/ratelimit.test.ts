import { beforeAll, describe, expect, it } from "vitest";
import { call, socket, type CallInit } from "./helpers.js";
import { server } from "./fixtures/apps/ratelimit/server.js";
import { server as proxiedServer } from "./fixtures/apps/ratelimit-proxy/server.js";

beforeAll(async () => {
  await server.load();
  await proxiedServer.load();
});

// Every test gets its own client address (TEST-NET-2), so buckets never collide.
let lastOctet = 0;
function client(): (init?: CallInit) => CallInit {
  const address = `198.51.100.${++lastOctet}`;
  return (init = {}) => ({ ...init, env: socket(address) });
}

describe("RatelimitPlugin", () => {
  it("allows the limit, then answers 429 with Retry-After", async () => {
    const as = client();
    expect((await call(server, "/fixed", as())).status).toBe(200);
    expect((await call(server, "/fixed", as())).status).toBe(200);
    const limited = await call(server, "/fixed", as());
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("sends standard and legacy headers on success", async () => {
    const res = await call(server, "/fixed", client()());
    expect(res.headers.get("ratelimit-limit")).toBe("2");
    expect(res.headers.get("ratelimit-remaining")).toBe("1");
    expect(res.headers.get("x-ratelimit-limit")).toBe("2");
    expect(res.headers.get("ratelimit-reset")).toMatch(/^\d+$/);
  });

  it.fails(
    "sends the rate-limit headers on 429 and error responses too (REVIEW §1.8)",
    async () => {
      const as = client();
      const invalid = await call(
        server,
        "/validated",
        as({ method: "POST", json: { n: "x" } }),
      );
      expect(invalid.status).toBe(400);
      expect(invalid.headers.get("ratelimit-limit")).toBe("2");
      await call(server, "/validated", as({ method: "POST", json: { n: 1 } }));
      const limited = await call(
        server,
        "/validated",
        as({ method: "POST", json: { n: 1 } }),
      );
      expect(limited.status).toBe(429);
      expect(limited.headers.get("ratelimit-remaining")).toBe("0");
    },
  );

  describe("client address (REVIEW §2.1)", () => {
    it("keys on the socket address and ignores X-Forwarded-For by default", async () => {
      const as = client();
      const spoof = (n: number) =>
        as({ headers: { "x-forwarded-for": `10.0.0.${n}` } });
      expect((await call(server, "/fixed", spoof(1))).status).toBe(200);
      expect((await call(server, "/fixed", spoof(2))).status).toBe(200);
      expect((await call(server, "/fixed", spoof(3))).status).toBe(429);
    });

    it("gives different sockets their own buckets", async () => {
      const first = client();
      const second = client();
      await call(server, "/fixed", first());
      await call(server, "/fixed", first());
      expect((await call(server, "/fixed", first())).status).toBe(429);
      expect((await call(server, "/fixed", second())).status).toBe(200);
    });

    it("with trustProxy: 1, keys on the address the proxy saw, not a forged one", async () => {
      const viaProxy = (forwardedFor: string): CallInit => ({
        env: socket("10.0.0.1"),
        headers: { "x-forwarded-for": forwardedFor },
      });
      expect(
        (await call(proxiedServer, "/limited", viaProxy("203.0.113.9"))).status,
      ).toBe(200);
      // The client prepends a forged hop; the proxy appended the real one.
      const forged = await call(
        proxiedServer,
        "/limited",
        viaProxy("192.0.2.77, 203.0.113.9"),
      );
      expect(forged.status).toBe(429);
      expect(
        (await call(proxiedServer, "/limited", viaProxy("203.0.113.10")))
          .status,
      ).toBe(200);
    });

    it("answers with onLimitReached's response when given", async () => {
      const as: CallInit = {
        env: socket("10.0.0.1"),
        headers: { "x-forwarded-for": "203.0.113.50" },
      };
      await call(proxiedServer, "/limited", as);
      const limited = await call(proxiedServer, "/limited", as);
      expect(limited.status).toBe(429);
      expect(limited.body.code).toBe("SLOW_DOWN");
      expect(limited.headers.get("retry-after")).not.toBeNull();
    });
  });

  it.each([
    ["sliding-window", "/sliding", 2],
    ["token-bucket (burst 3)", "/token", 3],
    ["leaky-bucket", "/leaky", 2],
  ])("limits with the %s algorithm", async (_name, path, allowed) => {
    const as = client();
    for (let i = 0; i < allowed; i += 1) {
      expect((await call(server, path, as())).status).toBe(200);
    }
    expect((await call(server, path, as())).status).toBe(429);
  });

  it("consumes manual rules only when the handler asks, then gates on them", async () => {
    const as = client();
    const post = (headers: Record<string, string> = {}) =>
      call(server, "/manual", as({ method: "POST", headers }));

    // Plain requests don't count against a manual rule.
    expect((await post()).body.data.peek.remaining).toBe(2);
    expect((await post()).body.data.peek.remaining).toBe(2);

    expect((await post({ "x-fail": "yes" })).body.data).toEqual({
      allowed: true,
      remaining: 1,
    });
    expect((await post({ "x-fail": "yes" })).body.data).toEqual({
      allowed: true,
      remaining: 0,
    });
    // Once the handler has used the rule up, it gates the route.
    expect((await post()).status).toBe(429);
  });

  it("resets and blocks through the c.ratelimiting helpers", async () => {
    const as = client();
    const post = (headers: Record<string, string> = {}) =>
      call(server, "/manual", as({ method: "POST", headers }));

    await post({ "x-fail": "yes" });
    expect((await post({ "x-reset": "yes" })).body.data).toEqual({
      reset: true,
    });
    expect((await post()).body.data.peek.remaining).toBe(2);

    await post({ "x-block": "yes" });
    const blocked = await post();
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMIT_BLOCKED");
  });

  it("scopes by user with an IP fallback, and can ignore params", async () => {
    const as = client();
    const user = (id: string) => as({ headers: { "x-user": id } });
    expect((await call(server, "/scoped/1", user("u1"))).status).toBe(200);
    expect((await call(server, "/scoped/2", user("u1"))).status).toBe(429);
    expect((await call(server, "/scoped/1", user("u2"))).status).toBe(200);
    expect((await call(server, "/scoped/1", as())).status).toBe(200);
    expect((await call(server, "/scoped/1", as())).status).toBe(429);
  });

  it("shares one bucket across clients with the global scope", async () => {
    expect((await call(server, "/global", client()())).status).toBe(200);
    expect((await call(server, "/global", client()())).status).toBe(429);
  });

  it("skips a rule when skip() says so", async () => {
    const as = client();
    const internal = as({ headers: { "x-internal": "yes" } });
    for (let i = 0; i < 3; i += 1) {
      expect((await call(server, "/skip", internal)).status).toBe(200);
    }
  });

  it("resolves dynamic limits and function scopes per request", async () => {
    const pro = { headers: { "x-plan": "pro" } };
    for (let i = 0; i < 5; i += 1) {
      expect((await call(server, "/dynamic", client()(pro))).status).toBe(200);
    }
    expect((await call(server, "/dynamic", client()(pro))).status).toBe(429);
    expect((await call(server, "/dynamic", client()())).status).toBe(200);
    expect((await call(server, "/dynamic", client()())).status).toBe(429);
  });

  it("enforces every rule of a multi-rule config", async () => {
    const as = client();
    expect((await call(server, "/multi", as())).status).toBe(200);
    expect((await call(server, "/multi", as())).status).toBe(429);
  });

  it("turns limiting off with ratelimit: false", async () => {
    const as = client();
    for (let i = 0; i < 4; i += 1) {
      const res = await call(server, "/off", as());
      expect(res.status).toBe(200);
      expect(res.headers.get("ratelimit-limit")).toBeNull();
    }
  });
});
