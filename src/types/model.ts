import type { z } from "zod";

/**
 * A named schema that the manifests describe once and route schemas point at.
 *
 * Declared with `server.models([...])` (or `ServerBuilder.models`, or
 * `new Server({ models })`) before routes load. Routes keep passing their
 * schemas as before: a route schema that is this instance (or a `.describe()`,
 * `.meta()`, `.refine()` or `.brand()` of it, wherever it sits) becomes
 * `{ "$ref": "#/models/<name>" }` in `/@client` and `/@docs`, and an object
 * that adds properties to it becomes `allOf` of that ref and the extra
 * properties. See `docs/concepts/models.md`.
 */
export type ModelDefinition = {
  /**
   * PascalCase (`^[A-Z][A-Za-z0-9]*$`) and unique on the server. It is the
   * model's key in the manifests' `models` (`#/models/<name>`), and the name
   * generated clients and docs give it.
   */
  name: string;
  /** The schema routes use. Anything but `z.void()`. */
  schema: z.ZodTypeAny;
  /**
   * Markdown for the model's docs page and its generated type. Defaults to
   * the schema's own `.describe()` text.
   */
  description?: string;
};
