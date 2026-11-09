import { beforeAll, describe, expect, it } from "vitest";
import { call, type CallInit } from "./helpers.js";
import { server } from "./fixtures/apps/limits/server.js";

beforeAll(async () => {
  await server.load();
});

const MiB = 1024 * 1024;
const jsonOfSize = (bytes: number) =>
  JSON.stringify({ text: "x".repeat(bytes - 11) });

/** A body without Content-Length, as a chunked upload arrives. */
function streamed(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        controller.enqueue(bytes.subarray(offset, offset + 64 * 1024));
      }
      controller.close();
    },
  });
}

describe("body limit (REVIEW §2.2)", () => {
  it("accepts a JSON body under the 1 MiB default", async () => {
    const res = await call(server, "/json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: jsonOfSize(MiB - 1024),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a JSON body over the default by Content-Length, with the envelope", async () => {
    const body = jsonOfSize(2 * MiB);
    const res = await call(server, "/json", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(body.length),
      },
      body,
    });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects an oversized body that arrives without Content-Length", async () => {
    const res = await call(server, "/json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: streamed(jsonOfSize(2 * MiB)),
      duplex: "half",
    } as CallInit);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("honours a per-route bodyLimit", async () => {
    const res = await call(server, "/tiny", {
      method: "POST",
      json: { text: "y".repeat(100) },
    });
    expect(res.status).toBe(413);
    expect(
      (await call(server, "/tiny", { method: "POST", json: { text: "ok" } }))
        .status,
    ).toBe(200);
  });

  it("raises the default for an upload route to its declared maxSize", async () => {
    const upload = (bytes: number) => {
      const form = new FormData();
      form.set("file", new File([new Uint8Array(bytes)], "a.bin"));
      return call(server, "/upload", { method: "POST", body: form });
    };
    expect((await upload(2 * MiB)).status).toBe(200);
    expect((await upload(4 * MiB)).status).toBe(413);
  });

  it("turns the limit off with bodyLimit: false", async () => {
    const res = await call(server, "/unlimited", {
      method: "POST",
      body: "z".repeat(2 * MiB),
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ length: 2 * MiB });
  });
});
