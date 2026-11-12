import { z, toJSONSchema } from "zod";
import type { ClientManifestJsonSchema } from "../client-manifest.js";
import { isZodDateSchema, isZodVoidSchema } from "./guards.js";
import type { ModelExtension, ModelRegistry } from "./models.js";

/** Where a ref to a declared model points, in both manifests. */
export const MODEL_REF_PREFIX = "#/models/";

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
): Record<string, unknown> {
  const payload = toJSONSchema(schema, {
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
      const extension = models.extensionOf(zodSchema);
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
 * `schema` behind a `z.lazy()`, which zod writes as a ref to it. That moves a
 * model into `$defs` even where it is the root: before zod 4.5 a root with an
 * `id` stays in place, and refs back to it are `#`.
 */
function asDefinition(schema: z.ZodTypeAny): z.ZodTypeAny {
  return z.lazy(() => schema);
}

/**
 * A route schema as the manifests carry it: JSON Schema (draft 2020-12,
 * output mode) with `$schema`, refs to declared models as `#/models/<name>`,
 * and any other definitions it needs in its own `$defs`. `z.void()` is
 * `{ type: "void" }`.
 */
export function zodToSerializableJsonSchema(
  schema: z.ZodTypeAny,
  models: ModelRegistry,
): ClientManifestJsonSchema {
  if (isZodVoidSchema(schema)) {
    return { type: "void" };
  }
  // Only a model: the lazy root would also move any other recursive root
  // into `$defs`, and apps without models get the schemas they always got.
  const root =
    models.nameOf(schema) === undefined ? schema : asDefinition(schema);
  const { $defs, ...json } = convert(root, models);
  return liftModelDefs(json, isJsonObject($defs) ? $defs : {}, models);
}

/**
 * Every declared model's body, in declaration order: its JSON Schema without
 * `$schema`, written in full (a model never extends another), refs to other
 * models (and to itself) as `#/models/<name>`, and its declared description.
 */
export function serializeModels(
  models: ModelRegistry,
): Record<string, ClientManifestJsonSchema> {
  const bodies: Record<string, ClientManifestJsonSchema> = {};
  for (const { name, schema, description } of models.definitions) {
    const { $defs } = convert(asDefinition(schema), models);
    const defs = isJsonObject($defs) ? $defs : {};
    const body = defs[name];
    // Before zod 4.5 the definition keeps its `id`, which is the name.
    const {
      description: ownDescription,
      id: _id,
      ...rest
    } = isJsonObject(body) ? body : {};
    const lifted = liftModelDefs(rest, defs, models);
    const text = description ?? ownDescription;
    bodies[name] =
      text === undefined ? lifted : { description: text, ...lifted };
  }
  return bodies;
}
