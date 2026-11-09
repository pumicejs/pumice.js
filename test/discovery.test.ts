import { describe, expect, it } from "vitest";
import { Server } from "pumice.js";
import { call } from "./helpers.js";
import { server } from "./fixtures/routes/app/server.js";
import { imported } from "./fixtures/routes/app/imported.js";

describe("route discovery", () => {
  it("loads once however often load() is called", async () => {
    const first = await server.load();
    const second = await server.load();
    expect(second).toBe(first);
    expect((await call(server, "/ok")).body.data).toBe("ok");
  });

  it.fails(
    "doesn't import files outside <rootDir>/<basePath> when a parent directory is called routes (REVIEW §1.3)",
    async () => {
      await server.load();
      expect(imported).not.toContain("lib/worker.ts");
    },
  );

  it.fails(
    "doesn't import test files that sit next to routes (REVIEW §1.3)",
    async () => {
      await server.load();
      expect(imported).not.toContain("routes/ok/route.spec.ts");
    },
  );

  it("throws when route() is called outside discovery", () => {
    const standalone = new Server({ rootDir: "/nonexistent" });
    expect(() =>
      standalone
        .route()
        .get()
        .handle(() => "x"),
    ).toThrow(/only be called while route files are being loaded/);
    expect(() =>
      standalone.middleware().handle(async (_c, next) => next()),
    ).toThrow(/only be called while middleware files are being loaded/);
  });

  it.todo(
    "listen() rejects when the port is taken instead of crashing the process (REVIEW §1.4): an it.fails here would crash the test worker",
  );

  it.fails(
    "applies a plugin registered after load() or refuses it (REVIEW §1.12)",
    async () => {
      await server.load();
      expect(() =>
        server.use({ apply: () => {} } as Parameters<typeof server.use>[0]),
      ).toThrow();
    },
  );
});
