import { beforeAll, describe, expect, it } from "vitest";
import { call } from "./helpers.js";
import { server } from "./fixtures/apps/files/server.js";

beforeAll(async () => {
  await server.load();
});

const file = (bytes: number, name: string, type: string) =>
  new File([new Uint8Array(bytes)], name, { type });

function form(entries: Array<[string, string | File]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

const upload = (path: string, entries: Array<[string, string | File]>) =>
  call(server, path, { method: "POST", body: form(entries) });

const fileCodes = (res: {
  body: { data: { files?: Array<{ code: string }> } };
}) => res.body.data.files?.map((issue) => issue.code);

describe("single file uploads", () => {
  const fields: Array<[string, string]> = [
    ["caption", "hi"],
    ["public", "true"],
    ["rank", "3"],
  ];

  it("accepts a valid file and coerces the other form fields", async () => {
    const res = await upload("/avatar", [
      ["avatar", file(10, "me.png", "image/png")],
      ...fields,
    ]);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      name: "me.png",
      size: 10,
      body: { caption: "hi", public: true, rank: 3 },
    });
  });

  it("matches allowed types by MIME type or by extension", async () => {
    const res = await upload("/avatar", [
      ["avatar", file(10, "me.JPG", "application/octet-stream")],
      ...fields,
    ]);
    expect(res.status).toBe(200);
  });

  it.each([
    ["too large", file(2048, "a.png", "image/png"), "file_too_large"],
    ["too small", file(1, "a.png", "image/png"), "file_too_small"],
    [
      "of a disallowed type",
      file(10, "a.gif", "image/gif"),
      "file_type_not_allowed",
    ],
  ])("rejects a file %s", async (_label, bad, code) => {
    const res = await upload("/avatar", [["avatar", bad], ...fields]);
    expect(res.status).toBe(400);
    expect(fileCodes(res)).toEqual([code]);
  });

  it("requires the file, and only one", async () => {
    expect(fileCodes(await upload("/avatar", fields))).toEqual([
      "file_missing",
    ]);
    const two = await upload("/avatar", [
      ["avatar", file(10, "a.png", "image/png")],
      ["avatar", file(10, "b.png", "image/png")],
      ...fields,
    ]);
    expect(fileCodes(two)).toEqual(["too_many_files"]);
  });

  it.fails(
    "rejects a file whose bytes don't match its declared type (REVIEW §2.5)",
    async () => {
      const notAPng = new File(
        [new TextEncoder().encode("#!/bin/sh\nrm -rf /\n")],
        "me.png",
        {
          type: "image/png",
        },
      );
      const res = await upload("/avatar", [["avatar", notAPng], ...fields]);
      expect(res.status).toBe(400);
    },
  );

  it("allows a missing optional file", async () => {
    const res = await upload("/optional", []);
    expect(res.body.data).toEqual({ hasFile: false });
  });

  it("reports a body that isn't multipart", async () => {
    const res = await call(server, "/avatar", { method: "POST", json: {} });
    expect(res.status).toBe(400);
    expect(res.body.data.body[0].code).toBe("invalid_body");
  });
});

describe("multiple file uploads", () => {
  const img = (name: string, bytes = 40) => file(bytes, name, "image/png");

  it("accepts files within the counts and sizes", async () => {
    const res = await upload("/gallery", [
      ["files", img("a.png")],
      ["files", img("b.png")],
    ]);
    expect(res.body.data).toEqual({ names: ["a.png", "b.png"] });
  });

  it("enforces min and max counts", async () => {
    expect(fileCodes(await upload("/gallery", []))).toEqual(["too_few_files"]);
    const four = await upload(
      "/gallery",
      ["a", "b", "c", "d"].map((n): [string, File] => [
        "files",
        img(`${n}.png`, 10),
      ]),
    );
    expect(fileCodes(four)).toEqual(["too_many_files"]);
  });

  it("enforces per-file and total sizes and the type pattern", async () => {
    const res = await upload("/gallery", [
      ["files", img("big.png", 120)],
      ["files", img("a.png", 60)],
      ["files", file(10, "doc.pdf", "application/pdf")],
    ]);
    expect(fileCodes(res)).toEqual([
      "file_too_large",
      "file_type_not_allowed",
      "files_total_too_large",
    ]);
  });
});
