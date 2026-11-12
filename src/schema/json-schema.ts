import { isDeepStrictEqual } from "node:util";
import { z, toJSONSchema } from "zod";
import type { ClientManifestJsonSchema } from "../client-manifest.js";
import { isZodDateSchema, isZodVoidSchema } from "./guards.js";
import type { ModelExtension, ModelRegistry } from "./models.js";

/** Where a ref to a declared model points, in both manifests. */
export const MODEL_REF_PREFIX = "#/models/";

/**
 * Which side of a zod schema its JSON Schema describes, as zod's `io` option:
 * `"input"` is what a client sends (a `.default()` is optional, a transform is
 * the type it accepts), `"output"` what the server sends.
 */
export type SchemaIo = "input" | "output";

/**
 * The models a route schema may point at, by side: in what the server sends
 * (responses, throws), every declared model; in what a client sends (body,
 * query, headers, params), only those whose input-mode JSON is their body
 * ({@link manifestModels}).
 */
export type ManifestModels = Readonly<Record<SchemaIo, ModelRegistry>>;

/** Where zod points refs to a schema it moved into the root's `$defs`. */
const DEFS_REF_PREFIX = "#/$defs/";

let isoDatetimeJsonSchemaFragment: Record<string, unknown> | undefined;

/**
 * `z.date()` has no JSON Schema (with `unrepresentable: "any"` zod writes
 * `{}`). A date goes over the wire as an ISO string, so the manifests give it
 * the schema zod writes for {@link z.iso.datetime}.
 */
function getIsoDatetimeJsonSchemaFragment(): Record<string, unknown> {
  if (!isoDatetimeJsonSchemaFragment) {
    const { $schema: _drop, ...fragment } = toJSONSchema(z.iso.datetime(), {
      unrepresentable: "any",
    });
    isoDatetimeJsonSchemaFragment = fragment;
  }
  return isoDatetimeJsonSchemaFragment;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Calls `visit` for every object under `value` (itself included) that has a
 * `$ref`, with that ref. `visit` may change the node's `$ref`.
 */
function forEachRef(
  value: unknown,
  visit: (ref: string, node: Record<string, unknown>) => void,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      forEachRef(item, visit);
    }
    return;
  }
  if (!isJsonObject(value)) {
    return;
  }
  if (typeof value.$ref === "string") {
    visit(value.$ref, value);
  }
  for (const child of Object.values(value)) {
    forEachRef(child, visit);
  }
}

/** RFC 6901: how a key appears as a segment of a JSON pointer such as `#/$defs/<key>`. */
function encodePointerSegment(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * The keys of `targets` that `roots` point at with `<prefix><key>` refs,
 * directly or through other targets.
 */
export function reachableRefs(
  roots: readonly unknown[],
  prefix: string,
  targets: Readonly<Record<string, unknown>>,
): Set<string> {
  const keyByRef = new Map(
    Object.keys(targets).map((key) => [
      `${prefix}${encodePointerSegment(key)}`,
      key,
    ]),
  );
  const reached = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    forEachRef(pending.pop(), (ref) => {
      const key = keyByRef.get(ref);
      if (key !== undefined && !reached.has(key)) {
        reached.add(key);
        pending.push(targets[key]);
      }
    });
  }
  return reached;
}

/**
 * Rewrites an object zod wrote in full into a pointer at the model it is
 * (`$ref`) or extends (`allOf` of the ref and an object with only the extra
 * properties). Annotations such as a use-site `description` stay on the node.
 */
function writeAsModelUse(
  json: z.core.JSONSchema.JSONSchema,
  { base, extraKeys }: ModelExtension,
): void {
  const { properties = {}, required = [] } = json;
  for (const key of [
    "type",
    "properties",
    "required",
    "additionalProperties",
    // Inherited from the object this one is a `.describe()` (or other clone)
    // of, which zod has already rewritten.
    "$ref",
    "allOf",
  ]) {
    delete json[key];
  }
  const ref = { $ref: `${MODEL_REF_PREFIX}${base}` };
  if (extraKeys.length === 0) {
    Object.assign(json, ref);
    return;
  }
  const extraRequired = required.filter((key) => extraKeys.includes(key));
  json.allOf = [
    ref,
    {
      type: "object",
      properties: Object.fromEntries(
        extraKeys.map((key) => [key, properties[key]]),
      ),
      ...(extraRequired.length > 0 ? { required: extraRequired } : {}),
    },
  ];
}

/** Zod's JSON Schema for `schema`, with dates as ISO strings and models as refs. */
function convert(
  schema: z.ZodTypeAny,
  models: ModelRegistry,
  io: SchemaIo,
): Record<string, unknown> {
  const payload = toJSONSchema(schema, {
    io,
    metadata: models.metadata,
    unrepresentable: "any",
    override({ zodSchema, jsonSchema }) {
      if (isZodDateSchema(zodSchema)) {
        for (const key of Object.keys(jsonSchema)) {
          delete jsonSchema[key];
        }
        Object.assign(jsonSchema, getIsoDatetimeJsonSchemaFragment());
        return;
      }
      const extension = models.extensionOf(zodSchema, io);
      if (extension !== undefined) {
        writeAsModelUse(jsonSchema, extension);
      }
    },
  });
  return JSON.parse(
    JSON.stringify(payload, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
}

/**
 * Takes the declared models out of `defs` (their bodies live under the
 * manifest's `models`) and points every ref to one at `#/models/<name>`. The
 * other definitions `root` still reaches stay local to it, under its `$defs`.
 */
function liftModelDefs(
  root: Record<string, unknown>,
  defs: Record<string, unknown>,
  models: ModelRegistry,
): ClientManifestJsonSchema {
  const local = Object.fromEntries(
    Object.entries(defs).filter(([key]) => !models.has(key)),
  );
  const reached = reachableRefs([root], DEFS_REF_PREFIX, local);
  for (const key of Object.keys(local)) {
    if (!reached.has(key)) {
      delete local[key];
    }
  }
  const lifted = reached.size > 0 ? { ...root, $defs: local } : root;
  forEachRef(lifted, (ref, node) => {
    const name = ref.slice(DEFS_REF_PREFIX.length);
    if (ref.startsWith(DEFS_REF_PREFIX) && models.has(name)) {
      node.$ref = `${MODEL_REF_PREFIX}${name}`;
    }
  });
  return lifted;
}

/**
 * A route schema as the manifests carry it: JSON Schema (draft 2020-12) of
 * the `io` side, with `$schema`, refs to the models that side may point at as
 * `#/models/<name>`, and any other definitions it needs in its own `$defs`.
 * `z.void()` is `{ type: "void" }`.
 */
export function zodToSerializableJsonSchema(
  schema: z.ZodTypeAny,
  models: ManifestModels,
  io: SchemaIo,
): ClientManifestJsonSchema {
  if (isZodVoidSchema(schema)) {
    return { type: "void" };
  }
  const registry = models[io];
  // A model at the root is moved into `$defs` by zod itself (4.5 and later,
  // the peer floor), the root becoming a ref to it.
  const { $defs, ...json } = convert(schema, registry, io);
  return liftModelDefs(json, isJsonObject($defs) ? $defs : {}, registry);
}

/**
 * Every declared model's body, in declaration order: its output-mode JSON
 * Schema without `$schema`, written in full (a model never extends another),
 * refs to other models (and to itself) as `#/models/<name>`, and its declared
 * description.
 */
export function serializeModels(
  models: ModelRegistry,
): Record<string, ClientManifestJsonSchema> {
  return serializeBodies(models, "output");
}

/**
 * The models a schema may point at on each side, given their bodies
 * ({@link serializeModels}).
 *
 * A model's body is output-mode JSON, so a client-sent schema points at a
 * model only where the model's input-mode JSON is that body, refs included,
 * and writes the others in full. What makes the two differ: a `.default()`
 * (optional in input mode), a transform (its input type), an object that
 * strips undeclared keys (input mode doesn't write `additionalProperties:
 * false`), or a model inside that differs.
 */
export function manifestModels(
  models: ModelRegistry,
  bodies: Readonly<Record<string, ClientManifestJsonSchema>>,
): ManifestModels {
  // Writing a model in full can change the input-mode JSON of a model that
  // contains it, so drop the ones that differ until none does.
  let input = models;
  let same = sameInputBodies(input, bodies);
  while (same.size < input.definitions.length) {
    input = models.subset(same);
    same = sameInputBodies(input, bodies);
  }
  return { output: models, input };
}

/** The models of `models` whose input-mode JSON, pointing at `models` only, is their body. */
function sameInputBodies(
  models: ModelRegistry,
  bodies: Readonly<Record<string, ClientManifestJsonSchema>>,
): Set<string> {
  const inputBodies = serializeBodies(models, "input");
  return new Set(
    Object.keys(inputBodies).filter((name) =>
      isDeepStrictEqual(inputBodies[name], bodies[name]),
    ),
  );
}

/** {@link serializeModels}, in `io` mode. */
function serializeBodies(
  models: ModelRegistry,
  io: SchemaIo,
): Record<string, ClientManifestJsonSchema> {
  const bodies: Record<string, ClientManifestJsonSchema> = {};
  for (const { name, schema, description } of models.definitions) {
    const { $defs } = convert(schema, models, io);
    const defs = isJsonObject($defs) ? $defs : {};
    const body = defs[name];
    const { description: ownDescription, ...rest } = isJsonObject(body)
      ? body
      : {};
    const lifted = liftModelDefs(rest, defs, models);
    const text = description ?? ownDescription;
    bodies[name] =
      text === undefined ? lifted : { description: text, ...lifted };
  }
  return bodies;
}
