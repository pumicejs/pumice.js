import { z } from "zod";
import type { ModelDefinition } from "../types/model.js";
import { isZodObjectSchema, isZodVoidSchema } from "./guards.js";
import type { SchemaIo } from "./json-schema.js";

/**
 * What a model name must look like: a type name in generated code, and a
 * segment `#/models/<name>` needs no escaping for.
 */
const MODEL_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

/**
 * How an object schema relates to a declared object model: it has every one
 * of the model's properties, as the model's own schema objects, plus
 * `extraKeys` (empty when it has exactly the model's properties).
 */
export type ModelExtension = {
  base: string;
  extraKeys: string[];
};

type ObjectModel = {
  name: string;
  schema: z.ZodObject;
  keys: string[];
};

/**
 * Whether two objects write the keys they don't declare the same way in `io`
 * mode: both strip them, both reject them (`.strict()`), or both check them
 * against the same schema. In output mode stripping and rejecting are alike
 * too: both write `additionalProperties: false`.
 */
function treatUndeclaredKeysAlike(
  a: z.ZodObject,
  b: z.ZodObject,
  io: SchemaIo,
): boolean {
  const isStrict = (catchall: z.core.$ZodType | undefined) =>
    catchall?._zod.def.type === "never";
  const isClosed = (catchall: z.core.$ZodType | undefined) =>
    catchall === undefined || isStrict(catchall);
  const aCatchall = a._zod.def.catchall;
  const bCatchall = b._zod.def.catchall;
  return (
    aCatchall === bCatchall ||
    (isStrict(aCatchall) && isStrict(bCatchall)) ||
    (io === "output" && isClosed(aCatchall) && isClosed(bCatchall))
  );
}

/**
 * Two objects whose JSON Schema is the same, because they share every
 * property schema. Judged in output mode, where a strip and a strict object
 * look alike too, so a response built from either couldn't be told apart.
 */
function haveSameShape(a: z.ZodTypeAny, b: z.ZodTypeAny): boolean {
  if (!isZodObjectSchema(a) || !isZodObjectSchema(b)) {
    return false;
  }
  const aShape = a._zod.def.shape;
  const bShape = b._zod.def.shape;
  const keys = Object.keys(aShape);
  return (
    keys.length === Object.keys(bShape).length &&
    keys.every(
      (key) => Object.hasOwn(bShape, key) && aShape[key] === bShape[key],
    ) &&
    treatUndeclaredKeysAlike(a, b, "output")
  );
}

/**
 * Throws on the first definition in `incoming` that can't be declared next to
 * `existing` and the ones before it. `where` names the caller in the message,
 * as `assertUniquePluginRegistration` does for plugins.
 */
export function assertModelDefinitions(
  existing: readonly ModelDefinition[],
  incoming: readonly ModelDefinition[],
  where: string,
): void {
  const declared = [...existing];
  for (const definition of incoming) {
    const { name, schema } = definition;
    if (!MODEL_NAME_PATTERN.test(name)) {
      throw new Error(
        `${where}: model name "${name}" must be PascalCase: a capital letter, then letters and digits.`,
      );
    }
    if (isZodVoidSchema(schema)) {
      throw new Error(
        `${where}: model "${name}" is z.void(); a model describes a value.`,
      );
    }
    for (const other of declared) {
      if (other.name === name) {
        throw new Error(`${where}: model "${name}" is declared twice.`);
      }
      if (other.schema === schema) {
        throw new Error(
          `${where}: models "${other.name}" and "${name}" are the same schema; declare it once.`,
        );
      }
      if (haveSameShape(other.schema, schema)) {
        throw new Error(
          `${where}: models "${other.name}" and "${name}" have the same properties, so a route schema built from them couldn't be told apart.`,
        );
      }
    }
    declared.push(definition);
  }
}

/**
 * Zod's global metadata, plus `id: <name>` on every schema of `models`. With
 * it, `toJSONSchema` writes each use of a model (direct, nested, nullable, in
 * a union, a `.describe()` of it, recursive) as a ref into `$defs/<name>`.
 */
class ModelMetadataRegistry extends z.core.$ZodRegistry<z.core.GlobalMeta> {
  /**
   * @param models The models refs may point at.
   * @param declared Every declared model: `models`, or the registry `models`
   *   is a subset of.
   */
  public constructor(
    private readonly models: ModelRegistry,
    private readonly declared: ModelRegistry,
  ) {
    super();
  }

  public override get<TSchema extends z.core.$ZodType>(
    schema: TSchema,
  ): z.core.$replace<z.core.GlobalMeta, TSchema> | undefined {
    const meta = z.globalRegistry.get(schema);
    const name = this.declared.nameOf(schema);
    if (name !== undefined) {
      if (this.models.has(name)) {
        return { ...meta, id: name };
      }
      // A model refs may not point at is written in full, whatever id it has.
      if (meta === undefined) {
        return undefined;
      }
      const { id: _id, ...rest } = meta;
      return rest;
    }
    // Lifting `$defs/<name>` into `#/models/<name>` would otherwise point this
    // schema at the model. Checked against every declared name, so the same
    // schema fails wherever it is used.
    if (meta?.id !== undefined && this.declared.has(meta.id)) {
      throw new Error(
        `A schema with .meta({ id: "${meta.id}" }) isn't the declared model "${meta.id}"; rename the id or the model.`,
      );
    }
    return meta;
  }
}

/**
 * The models a server declared, and how a schema is recognised as one.
 *
 * A schema is a model's use when it is the declared instance or a zod clone
 * of it (zod follows `_zod.parent`); an object is the model's use or extension
 * when it shares the model's property schemas ({@link extensionOf}). Anything
 * else is written out in full, which is always correct.
 */
export class ModelRegistry {
  private readonly declared: ModelDefinition[] = [];
  private readonly names = new Set<string>();
  private readonly nameBySchema = new Map<z.core.$ZodType, string>();
  /** Object models with at least one property, in declaration order. */
  private readonly objectModels: ObjectModel[] = [];

  /** Every declared model: this registry, or the one it is a subset of. */
  private readonly source: ModelRegistry;

  /** The metadata registry to pass to `toJSONSchema`. */
  public readonly metadata: z.core.$ZodRegistry<z.core.GlobalMeta>;

  /**
   * @param source Only for a {@link subset}: the registry it is taken from,
   *   whose names stay taken.
   */
  public constructor(source?: ModelRegistry) {
    this.source = source ?? this;
    this.metadata = new ModelMetadataRegistry(this, this.source);
  }

  /** Every declared model, in declaration order. */
  public get definitions(): readonly ModelDefinition[] {
    return this.declared;
  }

  /** Declares `definitions` after checking them ({@link assertModelDefinitions}). */
  public add(definitions: readonly ModelDefinition[], where: string): void {
    assertModelDefinitions(this.declared, definitions, where);
    for (const definition of definitions) {
      this.declare(definition);
    }
  }

  /**
   * The models named in `names`, as a registry of their own: what a
   * serialization that may point at no others is given. The rest are written
   * as if they weren't declared, but their names can't be taken by
   * `.meta({ id })` there either.
   */
  public subset(names: ReadonlySet<string>): ModelRegistry {
    const subset = new ModelRegistry(this.source);
    for (const definition of this.declared) {
      if (names.has(definition.name)) {
        subset.declare(definition);
      }
    }
    return subset;
  }

  private declare(definition: ModelDefinition): void {
    this.declared.push(definition);
    this.names.add(definition.name);
    this.nameBySchema.set(definition.schema, definition.name);
    const { schema } = definition;
    if (isZodObjectSchema(schema)) {
      const keys = Object.keys(schema._zod.def.shape);
      // An empty object would be the base of every object.
      if (keys.length > 0) {
        this.objectModels.push({ name: definition.name, schema, keys });
      }
    }
  }

  /** Whether a model with this name is declared. */
  public has(name: string): boolean {
    return this.names.has(name);
  }

  /** The name `schema` is declared under, if it is a declared instance. */
  public nameOf(schema: z.core.$ZodType): string | undefined {
    return this.nameBySchema.get(schema);
  }

  /**
   * The model an object schema is, or extends, judged by its properties.
   *
   * - Every property of the model, as the same schema objects (which
   *   `.extend()`, `.safeExtend()`, `.merge()`, `.pick()` and spreading
   *   `.shape` keep), and the same handling of undeclared keys in `io` mode:
   *   the object is that model when it has nothing else, and extends it
   *   otherwise. The largest such model wins; ties go to the one declared
   *   first.
   * - A larger model whose properties are all present but not all the same
   *   (`Image.extend({ size: z.string() })`) overrides it rather than adding
   *   to a smaller one, so the object stays inline.
   * - Declared models themselves are never anyone's extension: a model's body
   *   is written in full.
   */
  public extensionOf(
    schema: z.core.$ZodType,
    io: SchemaIo,
  ): ModelExtension | undefined {
    if (!isZodObjectSchema(schema) || this.nameBySchema.has(schema)) {
      return undefined;
    }
    const { shape } = schema._zod.def;
    let base: ObjectModel | undefined;
    let largestOverridden = 0;
    for (const model of this.objectModels) {
      if (!model.keys.every((key) => Object.hasOwn(shape, key))) {
        continue;
      }
      const modelShape = model.schema._zod.def.shape;
      const isSuperset =
        model.keys.every((key) => shape[key] === modelShape[key]) &&
        treatUndeclaredKeysAlike(schema, model.schema, io);
      if (!isSuperset) {
        largestOverridden = Math.max(largestOverridden, model.keys.length);
      } else if (base === undefined || model.keys.length > base.keys.length) {
        base = model;
      }
    }
    if (base === undefined || largestOverridden > base.keys.length) {
      return undefined;
    }
    const baseKeys = new Set(base.keys);
    return {
      base: base.name,
      extraKeys: Object.keys(shape).filter((key) => !baseKeys.has(key)),
    };
  }
}
