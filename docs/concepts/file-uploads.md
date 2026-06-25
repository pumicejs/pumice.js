# File Uploads

`pumice.js` supports `multipart/form-data` uploads with two route-builder
slices:

- **`.file({...})`** — exactly one file under a named field.
- **`.files({...})`** — an array of files under a named field.

Both are non-GET only (HTTP forbids bodies on `GET` requests in practice).
The framework parses the multipart body, validates against the config you
declared, and surfaces `c.file` / `c.files` typed as the standard Web
[`File`](https://developer.mozilla.org/en-US/docs/Web/API/File) object.

---

## Single-file uploads — `.file(config)`

```ts
import { z } from "pumice.js";

server
  .route()
  .post()
    .describe("Upload an avatar")
    .file({
      fieldName: "avatar",
      maxSize: 2 * 1024 * 1024,                // 2 MiB
      allowedTypes: ["image/png", "image/jpeg", ".webp"],
      required: true,                          // default
    })
    .response(z.object({ url: z.string() }))
    .handle(async (c) => {
      const buf = Buffer.from(await c.file.arrayBuffer());
      const url = await storage.put(c.file.name, buf);
      return { url };
    });
```

Inside the handler, `c.file` is a `File` instance:

```ts
c.file.name           // original filename (string)
c.file.type           // MIME type (string)
c.file.size           // bytes (number)
await c.file.arrayBuffer()
await c.file.text()
c.file.stream()       // ReadableStream<Uint8Array>
```

### `FileConfig` fields

| Field | Type | Default | Effect |
|---|---|---|---|
| `fieldName` | `string` | `"file"` | Multipart form field to read the file from |
| `maxSize` | `number` (bytes) | unbounded | Rejects with 400 if exceeded |
| `minSize` | `number` (bytes) | `0` | Rejects with 400 if below |
| `allowedTypes` | `AllowedFileType[]` | any | See [Type matching](#type-matching) |
| `required` | `boolean` | `true` | When `false`, `c.file` may be `undefined` |

When `required: false`, the type of `c.file` widens to `File | undefined`,
so you have to check it before reading.

---

## Multi-file uploads — `.files(config)`

```ts
server
  .route()
  .post()
    .files({
      fieldName: "attachments",
      maxCount: 5,
      maxSize: 5 * 1024 * 1024,                // each file ≤ 5 MiB
      totalMaxSize: 20 * 1024 * 1024,          // all combined ≤ 20 MiB
      allowedTypes: ["application/pdf", "image/*"],
    })
    .handle(async (c) => {
      // c.files: File[]
      const names = c.files.map((f) => f.name);
      return { names };
    });
```

### `FilesConfig` fields

| Field | Type | Default | Effect |
|---|---|---|---|
| `fieldName` | `string` | `"files"` | Multipart form field to read files from |
| `maxSize` | `number` | unbounded | Per-file size cap |
| `minSize` | `number` | `0` | Per-file size floor |
| `totalMaxSize` | `number` | unbounded | Sum-of-sizes cap across the whole array |
| `allowedTypes` | `AllowedFileType[]` | any | See [Type matching](#type-matching) |
| `minCount` | `number` | `0` | Minimum number of files required |
| `maxCount` | `number` | unbounded | Maximum number of files accepted |

`c.files` is always typed as `File[]`. If `minCount: 0` and no files
arrive, it's the empty array — never `undefined`.

---

## Type matching

`allowedTypes` accepts three matcher shapes; you can mix them:

- **Exact MIME type** — `"image/png"`, `"application/pdf"`.
- **MIME wildcard** — `"image/*"`, `"video/*"`.
- **File extension** — `".png"`, `".pdf"` (leading dot required).

Matchers are evaluated against each uploaded file's reported `Content-Type`
(for MIME forms) or filename suffix (for extension forms). A file matches
when **any** matcher matches.

Examples:

```ts
allowedTypes: ["image/png", "image/jpeg"]         // strict
allowedTypes: ["image/*"]                         // any image
allowedTypes: ["image/*", ".gif"]                 // any image + GIF by extension
allowedTypes: ["application/pdf", "text/plain"]   // docs only
```

A failed match produces a 415 (`UNSUPPORTED_MEDIA_TYPE`) error envelope.

---

## Combining files with body / query / headers

Files are independent of body / query / headers — you can declare them in
the same route:

```ts
server
  .route()
  .post()
    .body(z.object({ title: z.string() }))   // additional form fields parsed as the body
    .file({ fieldName: "thumbnail" })
    .handle(async (c) => {
      const file = c.file;
      const title = c.body.title;            // typed: string
      return await db.uploads.create({ title, blob: await file.arrayBuffer() });
    });
```

When using both, the request must be `multipart/form-data` and the
non-file fields are decoded into `c.body` using your declared body schema.
For pure JSON requests (no files), you don't need to do anything special —
`.body(...)` parses JSON by default.

---

## Common patterns

### Image-only upload with size + dimensions check

```ts
server
  .route()
  .post()
    .file({
      fieldName: "image",
      allowedTypes: ["image/png", "image/jpeg", "image/webp"],
      maxSize: 5 * 1024 * 1024,
    })
    .handle(async (c) => {
      const buf = Buffer.from(await c.file.arrayBuffer());
      const meta = await getImageMeta(buf);
      if (meta.width > 4096 || meta.height > 4096) {
        throw c.error({ status: 413, code: "TOO_LARGE", message: "Image too large." });
      }
      return await storage.putImage(buf);
    });
```

### Optional file field

```ts
server
  .route()
  .patch()
    .body(z.object({ name: z.string().optional() }))
    .file({ fieldName: "avatar", required: false })
    .handle(async (c) => {
      const updates: Record<string, unknown> = {};
      if (c.body.name) updates.name = c.body.name;
      if (c.file) updates.avatar = await storage.put(c.file.name, await c.file.arrayBuffer());
      return await db.users.update(c.auth.data.user.id, updates);
    });
```

### Bulk file upload with mixed types

```ts
server
  .route()
  .post()
    .files({
      fieldName: "documents",
      allowedTypes: ["application/pdf", "image/*", ".docx", ".xlsx"],
      maxCount: 10,
      totalMaxSize: 25 * 1024 * 1024,
    })
    .handle(async (c) => {
      const ids = await Promise.all(
        c.files.map(async (f) => storage.putDocument(f.name, await f.arrayBuffer())),
      );
      return { uploaded: ids };
    });
```

### Combining `.file(...)` and `.files(...)` on the same route

You can declare both, with different field names:

```ts
.file({ fieldName: "thumbnail" })
.files({ fieldName: "attachments", maxCount: 5 })
.handle((c) => ({
  thumbnail: c.file.name,
  attachments: c.files.map((f) => f.name),
}));
```

---

## Validation errors

Multipart validation errors are raised before your handler runs and return
a JSON error envelope:

| Status | Cause |
|---|---|
| `400` | Required file missing, file count below `minCount`, file count above `maxCount`, size below `minSize` |
| `413` | File above `maxSize` or total above `totalMaxSize` |
| `415` | File type not in `allowedTypes` |

The handler is not invoked when validation fails.

---

## Related

- [Route Builder — `.file(...) / .files(...)`](./route-builder.md#filefileconfig--filesfilesconfig-non-get)
- [`UploadedFile` / `FileConfig` / `FilesConfig`](../../README.md#api-exports) — types
- [Response Envelope](./response-envelope.md) — what error responses look like
