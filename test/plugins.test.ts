import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AuthenticationPlugin,
  ClientGenerationPlugin,
  RatelimitPlugin,
  Server,
} from "pumice.js";
import { call, socket } from "./helpers.js";
import { logLines, server } from "./fixtures/apps/plugins/server.js";

beforeAll(async () => {
  await server.load();
});

beforeEach(() => {
  logLines.length = 0;
});

const bearer = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
});

describe("AuthenticationPlugin", () => {
  it("rejects an unauthenticated request when the default requires auth", async () => {
    const res = await call(server, "/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      code: "UNAUTHORIZED",
      message: "Authentication is required for this route.",
    });
  });

  it("exposes the authenticator's data on the configured field", async () => {
    expect((await call(server, "/me", bearer("good"))).body.data).toEqual({
      id: "u1",
    });
  });

  it("lets a route opt out and still see the auth state", async () => {
    expect((await call(server, "/public")).body.data).toEqual({
      authenticated: false,
    });
    expect((await call(server, "/public", bearer("good"))).body.data).toEqual({
      authenticated: true,
    });
  });

  it.fails(
    "answers an authenticator that throws with the JSON envelope (REVIEW §1.7)",
    async () => {
      const res = await call(server, "/public", bearer("explode"));
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ code: "INTERNAL_ERROR" });
    },
  );
});

describe("plugin registration", () => {
  it("refuses a unique plugin registered twice", () => {
    const auth = () =>
      AuthenticationPlugin({ authenticator: () => ({ authenticated: false }) });
    expect(() => new Server().use(auth()).use(auth())).toThrow(
      /duplicate server plugin id "pumice.js\/authentication"/,
    );
    expect(() =>
      new Server().use(RatelimitPlugin()).use(ClientGenerationPlugin()),
    ).not.toThrow();
  });
});

describe("CorsPlugin", () => {
  it("answers a preflight for an allowed origin", async () => {
    const res = await call(server, "/me", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://app.example",
    );
    expect(res.headers.get("access-control-allow-headers")).toMatch(
      /Authorization/,
    );
  });

  it("adds the CORS headers to actual responses, and none for other origins", async () => {
    const allowed = await call(server, "/public", {
      headers: { origin: "https://app.example" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://app.example",
    );
    const other = await call(server, "/public", {
      headers: { origin: "https://evil.example" },
    });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("LoggerPlugin", () => {
  it("logs the request and the response with the socket address", async () => {
    await call(server, "/public", {
      env: socket("203.0.113.7"),
      headers: { "user-agent": "vitest", "x-forwarded-for": "10.9.9.9" },
    });
    expect(logLines[0]).toBe(
      '[REQUEST] GET /public ip=203.0.113.7 ua="vitest"',
    );
    expect(logLines[1]).toMatch(
      /^\[RESPONSE\] GET \/public status=200 duration_ms=\d+ content_length=/,
    );
  });

  it("logs error statuses", async () => {
    await call(server, "/boom");
    expect(logLines[1]).toMatch(/status=409/);
  });
});
