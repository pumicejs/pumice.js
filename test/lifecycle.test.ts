import { request, Agent } from "node:http";
import { createServer } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "./fixtures/apps/lifecycle/server.js";
import { closeGate } from "./fixtures/apps/lifecycle/gate.js";

type Answer = { status: number; connection?: string; data: unknown };

/** One GET over a real socket, through `agent` so keep-alive connections are reused. */
function get(port: number, path: string, agent: Agent): Promise<Answer> {
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path, agent }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (text += chunk));
      response.on("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          connection: response.headers.connection,
          data: (JSON.parse(text) as { data: unknown }).data,
        }),
      );
    })
      .on("error", reject)
      .end();
  });
}

describe("listen() and close()", () => {
  let agent: Agent;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    agent = new Agent({ keepAlive: true });
  });

  afterEach(async () => {
    agent.destroy();
    await server.close();
    vi.restoreAllMocks();
  });

  it("resolves once the port is bound, with the address", async () => {
    const address = await server.listen({ port: 0, hostname: "127.0.0.1" });
    expect(address.address).toBe("127.0.0.1");
    expect(address.port).toBeGreaterThan(0);
    expect(await get(address.port, "/ok", agent)).toMatchObject({
      status: 200,
      data: "ok",
    });
  });

  it("rejects when the port is taken, and can listen again after (REVIEW §1.4)", async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const { port } = taken.address() as { port: number };
    try {
      await expect(
        server.listen({ port, hostname: "127.0.0.1" }),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      taken.close();
    }
    const address = await server.listen({ port: 0, hostname: "127.0.0.1" });
    expect((await get(address.port, "/ok", agent)).data).toBe("ok");
  });

  it("refuses a second listen() while listening", async () => {
    await server.listen({ port: 0, hostname: "127.0.0.1" });
    await expect(
      server.listen({ port: 0, hostname: "127.0.0.1" }),
    ).rejects.toThrow(/already listening/);
  });

  it("lets a request under way finish, and ends once it has", async () => {
    const { port } = await server.listen({ port: 0, hostname: "127.0.0.1" });
    // An idle keep-alive connection, which close() ends at once.
    await get(port, "/ok", agent);
    const gate = closeGate();
    const slow = get(port, "/slow", agent);
    await gate.arrived;

    let closed = false;
    const closing = server.close().then(() => (closed = true));
    expect(server.close()).toBe(server.close());
    await expect(get(port, "/ok", new Agent())).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
    expect(closed).toBe(false);

    const started = Date.now();
    gate.open();
    expect(await slow).toMatchObject({ status: 200, data: "slow" });
    await closing;
    // Node would otherwise keep the connection for its 5 s keep-alive timeout.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("tells the client a request under way is the connection's last", async () => {
    const { port } = await server.listen({ port: 0, hostname: "127.0.0.1" });
    const gate = closeGate();
    const slow = get(port, "/slow", agent);
    await gate.arrived;
    const closing = server.close();
    gate.open();
    expect((await slow).connection).toBe("close");
    await closing;
  });

  it("resolves at once when not listening, and may listen again after", async () => {
    await expect(server.close()).resolves.toBeUndefined();
    await server.listen({ port: 0, hostname: "127.0.0.1" });
    await server.close();
    const { port } = await server.listen({ port: 0, hostname: "127.0.0.1" });
    expect((await get(port, "/ok", agent)).data).toBe("ok");
  });
});
