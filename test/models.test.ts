import { beforeAll, describe, expect, it } from "vitest";
import { Server, ServerBuilder, z, type ModelDefinition } from "pumice.js";
import {
  serializeModels,
  zodToSerializableJsonSchema,
} from "../src/schema/json-schema.js";
import { ModelRegistry } from "../src/schema/models.js";
import { call } from "./helpers.js";
import { server } from "./fixtures/apps/models/server.js";

const SCHEMA = "https://json-schema.org/draft/2020-12/schema";
const EMPTY_APP = new URL("./fixtures/apps/empty/", import.meta.url).pathname;

const ref = (name: string) => ({ $ref: `#/models/${name}` });

const User = z.object({
  id: z.string().describe("Stable user id"),
  name: z.string(),
  email: z.string(),
  bio: z.string(),
});
const PartialUser = User.pick({ id: true, name: true });
const Board = z.object({ id: z.number(), owner: User.nullable() });
const Category = z.object({
  name: z.string(),
  get children() {
    return z.array(Category);
  },
});
const TreeNode = z.object({
  value: z.number(),
  get children() {
    return z.array(TreeNode);
  },
});
const Folder = z.object({ id: z.number(), tree: TreeNode });
const Visibility = z.enum(["public", "private"]).describe("Who can see it");

const models = new ModelRegistry();
models.add(
  [
    { name: "User", schema: User, description: "Someone with an account." },
    { name: "PartialUser", schema: PartialUser },
    { name: "Board", schema: Board },
    { name: "Category", schema: Category },
    { name: "Folder", schema: Folder },
    { name: "Visibility", schema: Visibility },
  ],
  "test",
);

const serialize = (schema: z.ZodTypeAny) =>
  zodToSerializableJsonSchema(schema, models);

const userJson = {
  type: "object",
  properties: {
    id: { type: "string", description: "Stable user id" },
    name: { type: "string" },
    email: { type: "string" },
    bio: { type: "string" },
  },
  required: ["id", "name", "email", "bio"],
  additionalProperties: false,
};

describe("a declared model in a route schema", () => {
  it.each<[string, z.ZodTypeAny, Record<string, unknown>]>([
    ["itself", User, ref("User")],
    ["a .brand() of it", User.brand(), ref("User")],
    ["a .refine() of it", User.refine(() => true), ref("User")],
    [
      "a .meta() of it",
      User.meta({ title: "Owner" }),
      { title: "Owner", ...ref("User") },
    ],
    [
      "a .describe() of it, keeping the use-site description",
      User.describe("The board's owner"),
      { description: "The board's owner", ...ref("User") },
    ],
    [
      "a .describe() of a .describe() of it",
      User.describe("draft").describe("The board's owner"),
      { description: "The board's owner", ...ref("User") },
    ],
    ["an array of it", z.array(User), { type: "array", items: ref("User") }],
    [
      "it, nullable",
      User.nullable(),
      { anyOf: [ref("User"), { type: "null" }] },
    ],
    [
      "a record of it",
      z.record(z.string(), User),
      {
        type: "object",
        propertyNames: { type: "string" },
        additionalProperties: ref("User"),
      },
    ],
    [
      "a union of models",
      z.union([User, PartialUser]),
      { anyOf: [ref("User"), ref("PartialUser")] },
    ],
    [
      "an optional property",
      z.object({ owner: User.optional() }),
      {
        type: "object",
        properties: { owner: ref("User") },
        additionalProperties: false,
      },
    ],
    [
      "a model that contains a model",
      z.object({ board: Board }),
      {
        type: "object",
        properties: { board: ref("Board") },
        required: ["board"],
        additionalProperties: false,
      },
    ],
    [
      "a recursive model",
      z.array(Category),
      { type: "array", items: ref("Category") },
    ],
    ["a model with a recursive part that isn't a model", Folder, ref("Folder")],
    ["a model that isn't an object", Visibility, ref("Visibility")],
  ])("is a ref: %s", (_label, schema, expected) => {
    expect(serialize(schema)).toEqual({ $schema: SCHEMA, ...expected });
  });

  it.each<[string, z.ZodTypeAny]>([
    ["spreading its shape", z.object({ ...PartialUser.shape })],
    ["the same .pick() of its source", User.pick({ id: true, name: true })],
    ["a .strict() of it", PartialUser.strict()],
  ])(
    "is a ref when an object has exactly its properties: %s",
    (_label, schema) => {
      expect(serialize(schema)).toEqual({
        $schema: SCHEMA,
        ...ref("PartialUser"),
      });
    },
  );
});

describe("an object that extends a model", () => {
  it("is allOf of the ref and the extra properties", () => {
    expect(serialize(User.extend({ isMe: z.boolean() }))).toEqual({
      $schema: SCHEMA,
      allOf: [
        ref("User"),
        {
          type: "object",
          properties: { isMe: { type: "boolean" } },
          required: ["isMe"],
        },
      ],
    });
  });

  it.each<[string, z.ZodTypeAny]>([
    ["safeExtend()", User.safeExtend({ isMe: z.boolean() })],
    ["merge()", User.merge(z.object({ isMe: z.boolean() }))],
    ["a spread", z.object({ ...User.shape, isMe: z.boolean() })],
  ])("is recognised from %s", (_label, schema) => {
    expect(serialize(schema)).toEqual(
      serialize(User.extend({ isMe: z.boolean() })),
    );
  });

  it("keeps the use-site description and optional extras", () => {
    const schema = User.extend({ note: z.string().optional() }).describe("You");
    expect(serialize(schema)).toEqual({
      $schema: SCHEMA,
      description: "You",
      allOf: [
        ref("User"),
        { type: "object", properties: { note: { type: "string" } } },
      ],
    });
  });

  it("is recognised inside an array", () => {
    const sessions = z.array(
      User.extend({ current: z.boolean().describe("This session") }),
    );
    expect(serialize(sessions)).toEqual({
      $schema: SCHEMA,
      type: "array",
      items: {
        allOf: [
          ref("User"),
          {
            type: "object",
            properties: {
              current: { type: "boolean", description: "This session" },
            },
            required: ["current"],
          },
        ],
      },
    });
  });

  it("extends the largest model it contains: a wider .pick() of the source", () => {
    expect(serialize(User.pick({ id: true, name: true, email: true }))).toEqual(
      {
        $schema: SCHEMA,
        allOf: [
          ref("PartialUser"),
          {
            type: "object",
            properties: { email: { type: "string" } },
            required: ["email"],
          },
        ],
      },
    );
  });
});

describe("an object that isn't a model or an extension stays inline", () => {
  it("overriding a property of a larger model, even if a smaller one is all there", () => {
    // Every PartialUser property is shared, but this is a User with another
    // `bio`, not a PartialUser plus three fields.
    expect(serialize(User.extend({ bio: z.number() }))).toEqual({
      $schema: SCHEMA,
      ...userJson,
      properties: { ...userJson.properties, bio: { type: "number" } },
    });
  });

  it("a .pick() that leaves out a property of every model", () => {
    expect(serialize(User.pick({ id: true, email: true }))).toEqual({
      $schema: SCHEMA,
      type: "object",
      properties: {
        id: { type: "string", description: "Stable user id" },
        email: { type: "string" },
      },
      required: ["id", "email"],
      additionalProperties: false,
    });
  });

  it("a .partial()", () => {
    const { required: _required, ...partial } = userJson;
    expect(serialize(User.partial())).toEqual({ $schema: SCHEMA, ...partial });
  });

  it("one that lets undeclared keys through", () => {
    expect(serialize(PartialUser.loose())).toEqual({
      $schema: SCHEMA,
      type: "object",
      properties: {
        id: { type: "string", description: "Stable user id" },
        name: { type: "string" },
      },
      required: ["id", "name"],
      additionalProperties: {},
    });
  });

  it("keeps the definitions it needs for itself", () => {
    expect(serialize(z.object({ folder: Folder, tree: TreeNode }))).toEqual({
      $schema: SCHEMA,
      type: "object",
      properties: {
        folder: ref("Folder"),
        tree: { $ref: "#/$defs/__schema0" },
      },
      required: ["folder", "tree"],
      additionalProperties: false,
      $defs: {
        __schema0: {
          type: "object",
          properties: {
            value: { type: "number" },
            children: {
              type: "array",
              items: { $ref: "#/$defs/__schema0" },
            },
          },
          required: ["value", "children"],
          additionalProperties: false,
        },
      },
    });
  });
});

describe("model bodies", () => {
  const bodies = serializeModels(models);

  it("are written in full, with the declared description, in declaration order", () => {
    expect(Object.keys(bodies)).toEqual([
      "User",
      "PartialUser",
      "Board",
      "Category",
      "Folder",
      "Visibility",
    ]);
    expect(bodies.User).toEqual({
      description: "Someone with an account.",
      ...userJson,
    });
    // A pick of User, but a model's body never refers to another model it
    // shares properties with.
    expect(bodies.PartialUser).toEqual({
      type: "object",
      properties: {
        id: { type: "string", description: "Stable user id" },
        name: { type: "string" },
      },
      required: ["id", "name"],
      additionalProperties: false,
    });
  });

  it("fall back to the schema's own description", () => {
    expect(bodies.Visibility).toEqual({
      description: "Who can see it",
      type: "string",
      enum: ["public", "private"],
    });
  });

  it("refer to other models, and to themselves", () => {
    expect(bodies.Board).toEqual({
      type: "object",
      properties: {
        id: { type: "number" },
        owner: { anyOf: [ref("User"), { type: "null" }] },
      },
      required: ["id", "owner"],
      additionalProperties: false,
    });
    expect(bodies.Category).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        children: { type: "array", items: ref("Category") },
      },
      required: ["name", "children"],
      additionalProperties: false,
    });
  });

  it("carry the definitions only they need", () => {
    expect(bodies.Folder).toEqual({
      type: "object",
      properties: {
        id: { type: "number" },
        tree: { $ref: "#/$defs/__schema0" },
      },
      required: ["id", "tree"],
      additionalProperties: false,
      $defs: {
        __schema0: {
          type: "object",
          properties: {
            value: { type: "number" },
            children: {
              type: "array",
              items: { $ref: "#/$defs/__schema0" },
            },
          },
          required: ["value", "children"],
          additionalProperties: false,
        },
      },
    });
  });
});

describe("declaring models", () => {
  const declare = (definitions: ModelDefinition[]) => () =>
    new Server({ rootDir: EMPTY_APP }).models(definitions);
  const Thing = z.object({ id: z.string() });

  it.each(["thing", "Thing-1", "1Thing", ""])("rejects the name %j", (name) => {
    expect(declare([{ name, schema: Thing }])).toThrow(
      /Server\.models: model name ".*" must be PascalCase/,
    );
  });

  it("rejects a name declared twice", () => {
    expect(
      declare([
        { name: "Thing", schema: Thing },
        { name: "Thing", schema: z.string() },
      ]),
    ).toThrow('model "Thing" is declared twice');
  });

  it("rejects a schema declared twice", () => {
    expect(
      declare([
        { name: "Thing", schema: Thing },
        { name: "Other", schema: Thing },
      ]),
    ).toThrow('models "Thing" and "Other" are the same schema');
  });

  it("rejects two objects with the same properties", () => {
    expect(
      declare([
        { name: "Thing", schema: Thing },
        { name: "Other", schema: z.object({ ...Thing.shape }) },
      ]),
    ).toThrow('models "Thing" and "Other" have the same properties');
  });

  it("rejects z.void()", () => {
    expect(declare([{ name: "Nothing", schema: z.void() }])).toThrow(
      'model "Nothing" is z.void()',
    );
  });

  it("checks across calls, and in the builder at the call", () => {
    const standalone = new Server({
      rootDir: EMPTY_APP,
      models: [{ name: "Thing", schema: Thing }],
    });
    expect(() =>
      standalone.models([{ name: "Thing", schema: z.number() }]),
    ).toThrow('model "Thing" is declared twice');
    expect(() =>
      new ServerBuilder().models([{ name: "thing", schema: Thing }]),
    ).toThrow(/^ServerBuilder\.models: model name "thing"/);
  });

  it("rejects a .meta({ id }) that is a model's name on another schema", () => {
    const impostor = z.object({ id: z.number() }).meta({ id: "User" });
    expect(() => serialize(z.array(impostor))).toThrow(
      `A schema with .meta({ id: "User" }) isn't the declared model "User"`,
    );
  });
});

describe("a server with models", () => {
  beforeAll(async () => {
    await server.load();
  });

  it("refuses models once routes have loaded", () => {
    expect(() =>
      server.models([
        { name: "Late", schema: z.object({ late: z.boolean() }) },
      ]),
    ).toThrow(
      "Server.models: declare models before routes load (Late came after the first route).",
    );
  });

  it("uses them in bodies and throws data too", () => {
    const notes = server
      .getClientManifest()
      .routes.find((route) => route.path === "/notes");
    expect(notes?.methods.post?.schema).toEqual({
      body: { $schema: SCHEMA, ...ref("Draft") },
      response: {
        shape: "statusMap",
        statuses: { 201: { $schema: SCHEMA, ...ref("Note") } },
      },
      throws: {
        422: {
          kind: "descriptor",
          message: "The note can't be saved",
          data: { $schema: SCHEMA, ...ref("Problem") },
        },
      },
    });
  });

  it("lists every declared model in getClientManifest()", () => {
    expect(Object.keys(server.getClientManifest().models)).toEqual([
      "Note",
      "Draft",
      "Problem",
      "Secret",
    ]);
  });

  it("lists only the models each manifest's routes use", async () => {
    const client = (await call(server, "/@client")).body.data;
    const docs = (await call(server, "/@docs")).body.data;
    expect(Object.keys(client.models)).toEqual(["Note", "Draft", "Problem"]);
    expect(Object.keys(docs.models)).toEqual(["Note", "Draft", "Problem"]);
    expect(client.models.Note).toEqual({
      description: "A note.",
      type: "object",
      properties: { id: { type: "number" }, text: { type: "string" } },
      required: ["id", "text"],
      additionalProperties: false,
    });
  });
});
