import type {
  RouteHandler,
  RouteMethod,
  RouteRegistration,
} from "../types/route.js";
import type { RouteConfig } from "../types/config.js";
import type {
  ApplyContextRefinementRules,
  ContextRefinementRule,
} from "../types/plugin.js";
import type {
  RouteResponseSchema,
  RouteResponseSchemaInput,
  RouteParamsSchema,
  RouteSchema,
  Simplify,
  RouteThrowsSchemaMap,
  RouteThrowsSchemaInput,
} from "../types/schema.js";
import type {
  AnyAppliedRouteProcedure,
  AnyRouteProcedureDefinition,
  AppliedRouteProcedure,
  InferAppliedProcedureContributions,
  InferMergedParamsValue,
  RouteProcedureApplyOptions,
} from "../types/procedure.js";
import type { FileConfig, FilesConfig } from "../types/file.js";
import type { z } from "zod";
import { mergeRouteConfig } from "../config/routes.js";

type RouteConfigCapabilities = object;

type MergeRouteSchemaPatch<
  TCurrentSchema extends RouteSchema,
  TSchemaPatch extends Partial<RouteSchema>,
> = Simplify<Omit<TCurrentSchema, keyof TSchemaPatch> & TSchemaPatch>;

type IsPlainObject<TValue> = TValue extends object
  ? TValue extends (...args: never[]) => unknown
    ? false
    : TValue extends readonly unknown[]
      ? false
      : true
  : false;

type DeepMergeObjects<TBaseObject, TOverrideObject> = Simplify<
  Omit<TBaseObject, keyof TOverrideObject> & {
    [TKey in keyof TOverrideObject]: TKey extends keyof TBaseObject
      ? IsPlainObject<TBaseObject[TKey]> extends true
        ? IsPlainObject<TOverrideObject[TKey]> extends true
          ? DeepMergeObjects<TBaseObject[TKey], TOverrideObject[TKey]>
          : TOverrideObject[TKey]
        : TOverrideObject[TKey]
      : TOverrideObject[TKey];
  }
>;

type ResolveRouteContextForConfig<
  TContextExtensions extends object,
  TContextRefinementRules extends ContextRefinementRule,
  TEffectiveConfig extends object,
> = Simplify<
  TContextExtensions &
    ApplyContextRefinementRules<TContextRefinementRules, TEffectiveConfig>
>;

type GetRouteSchemaDefinition = {
  /**
   * GET routes cannot define request body schemas.
   */
  body?: never;
  /**
   * GET routes cannot accept file uploads.
   */
  file?: never;
  /**
   * GET routes cannot accept file uploads.
   */
  files?: never;
  /**
   * Query string schema.
   *
   * Example:
   * `query: z.object({ name: z.string(), page: z.coerce.number().default(1) })`
   */
  query?: RouteSchema["query"];
  /**
   * Request headers schema.
   */
  headers?: RouteSchema["headers"];
  /**
   * Success response schema declaration.
   *
   * Allowed shapes:
   * - Single schema: `response: z.object({...})`
   * - 2xx status map: `response: { 200: A, 201: B }`
   */
  response?: RouteSchema["response"];
  /**
   * Declares typed throwable error contracts (4xx only).
   *
   * Allowed shapes per status:
   * - Direct schema: `404: z.object({...})`
   * - Descriptor: `404: { data: z.object({...}), issues: z.array(...), message: "..." }`
   * - Code map: `422: { INVALID_NAME: { data: ..., message: "..." } }`
   */
  throws?: RouteSchema["throws"];
};

type RouteSchemaDefinitionForMethod<TMethod extends RouteMethod> =
  TMethod extends "get" ? GetRouteSchemaDefinition : RouteSchema;

/**
 * Stage of the route builder after an HTTP method has been selected
 * (e.g. after `.get()`, `.post()`).
 *
 * From here, callers attach schemas (body / query / headers / response /
 * throws / file / files), per-method config, an optional human-readable
 * description, and finally call `.handle(handler)` to register the route.
 *
 * Re-entry into the previous stage happens automatically once `.handle()`
 * runs, so a single chain can declare multiple methods on the same path.
 *
 * Method-specific constraints (enforced at type level via `this: never`):
 * - GET routes cannot declare `body`, `file`, or `files`.
 *
 * @typeParam TSchema Accumulated schema declared so far on this method.
 * @typeParam TMethod Selected HTTP method (`"get" | "post" | "put" | ...`).
 * @typeParam TParamsSchema Path-params schema declared at the route level via `.params(...)`.
 * @typeParam TContextExtensions Plugin-contributed context fields.
 * @typeParam TFeatures Plugin-contributed route-config keys.
 * @typeParam TContextRefinementRules Conditional context refinements based on effective config.
 * @typeParam TRouteConfig Route-level defaults declared via `.route().config(...)`.
 * @typeParam TEffectiveConfig Method-level effective config after merging route defaults with `.config(...)` calls in this stage.
 * @typeParam TProcedures Tuple of procedures attached via `.procedure(...)` in the parent stage.
 */
export interface RouteBuilderMethodStage<
  TSchema extends RouteSchema = {},
  TMethod extends RouteMethod = RouteMethod,
  TParamsSchema extends RouteParamsSchema | undefined = undefined,
  TContextExtensions extends object = {},
  TFeatures extends RouteConfigCapabilities = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TRouteConfig extends object = {},
  TEffectiveConfig extends object = TRouteConfig,
  TProcedures extends readonly AnyAppliedRouteProcedure[] = [],
> {
  /**
   * Declares the request body schema.
   *
   * The request body is parsed as JSON (or `multipart/form-data` if `.file()` /
   * `.files()` is also declared) and validated against `schema`. The validated
   * value is surfaced on `c.body` with full type inference.
   *
   * Equivalent to passing `body` to `.schema({ body: ... })`.
   *
   * **Constraint**: GET routes are blocked at type level via `this: never`.
   *
   * @example `.body(z.object({ name: z.string(), email: z.string().email() }))`
   */
  body<TBodySchema extends z.ZodTypeAny>(
    this: TMethod extends "get"
      ? never
      : RouteBuilderMethodStage<
          TSchema,
          TMethod,
          TParamsSchema,
          TContextExtensions,
          TFeatures,
          TContextRefinementRules,
          TRouteConfig,
          TEffectiveConfig,
          TProcedures
        >,
    schema: TBodySchema,
  ): RouteBuilderMethodStage<
    MergeRouteSchemaPatch<TSchema, { body: TBodySchema }>,
    TMethod,
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TRouteConfig,
    TEffectiveConfig,
    TProcedures
  >;
  /**
   * Applies per-method runtime config.
   *
   * Deep-merged in precedence order: server defaults < route-level
   * `.route().config(...)` < this method-level call. Subsequent calls on the
   * same method are also deep-merged. The merged result drives plugin
   * behavior at request time (auth requirements, ratelimits, client-exposure
   * flags, etc.).
   *
   * Type-level: tightens `TEffectiveConfig` so plugin context refinements
   * (e.g. `c.auth.data` becoming non-optional) apply to this method's handler.
   *
   * @example `.config({ authentication: { required: true }, ratelimit: { limit: 10, timeframe: 60_000 } })`
   */
  config<TNextConfig extends RouteConfig<TFeatures>>(
    config: TNextConfig,
  ): RouteBuilderMethodStage<
    TSchema,
    TMethod,
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TRouteConfig,
    DeepMergeObjects<TEffectiveConfig, TNextConfig>,
    TProcedures
  >;
  /**
   * Attaches a human-readable description to the route.
   *
   * Surfaced in registration logs and in the generated client manifest as
   * `methods[method].descriptor`. Has no runtime effect on routing.
   *
   * @example `.describe("Get a user by id")`
   */
  describe(description: string): RouteBuilderMethodStage<
    TSchema,
    TMethod,
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TRouteConfig,
    TEffectiveConfig,
    TProcedures
  >;
  /**
   * Declares the request / response schema in one shot, deep-merging into any
   * existing partial schema (keys you omit are kept — including `file` /
   * `files` previously declared via `.file()` / `.files()`).
   *
   * Available keys:
   * - `body`, `query`, `headers` — request validation; values surface on `c.body` / `c.query` / `c.headers`
   * - `file`, `files` — multipart upload contracts; values surface on `c.file` / `c.files` (non-GET only)
   * - `response` — success response schema (single Zod schema or `{ 2xx: schema }` map; constrains `c.json`, `c.response`, and the implicit handler return value)
   * - `throws` — typed error contracts per 4xx status; constrains `c.error` and validates thrown `ApiError`s
   *
   * GET-specific constraint: `body`, `file`, and `files` are typed as `never`.
   *
   * @example
   * ```ts
   * .schema({
   *   query: z.object({ page: z.coerce.number().default(1) }),
   *   response: { 200: UserListSchema },
   *   throws: {
   *     404: { data: NotFoundDataSchema, message: "User not found" },
   *     422: { INVALID_INPUT: { data: ValidationDataSchema, issues: z.array(IssueSchema) } },
   *   },
   * })
   * ```
   */
  schema<TNextSchema extends RouteSchemaDefinitionForMethod<TMethod>>(
    schema: TNextSchema & RouteSchemaDefinitionForMethod<TMethod>,
  ): RouteBuilderMethodStage<
    TNextSchema,
    TMethod,
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TRouteConfig,
    TEffectiveConfig,
    TProcedures
  >;
  /**
   * Declares the query-string validation schema.
   *
   * Validated values are surfaced on `c.query`. Use `z.coerce.*` (or the
   * framework's auto-coercion of query strings) to convert raw strings into
   * numbers / booleans.
   *
   * @example `.query(z.object({ page: z.coerce.number().default(1), search: z.string().optional() }))`
   */
  query<TQuerySchema extends z.ZodTypeAny>(
    schema: TQuerySchema,
  ): RouteBuilderMethodStage<
    MergeRouteSchemaPatch<TSchema, { query: TQuerySchema }>,
    TMethod,
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TRouteConfig,
    TEffectiveConfig,
    TProcedures
  >;
  /**
   * Declares the request-headers validation schema.
   *
   * Validated values are surfaced on `c.headers`. Header names are matched
   * case-insensitively per HTTP semantics; declare them lowercase in the
   * schema.
   *
   * @example `.headers(z.object({ "x-api-key": z.string() }))`
   */
  headers<THeadersSchema extends z.ZodTypeAny>(
    schema: THeadersSchema,
  ): RouteBuilderMethodStage<
    MergeRouteSchemaPatch<TSchema, { headers: THeadersSchema }>,
    TMethod,
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TRouteConfig,
    TEffectiveConfig,
    TProcedures
  >;
  /**
   * Declares the success-response schema.
   *
   * Two shapes are accepted:
   * - A single Zod schema applied to every 2xx response.
   * - A `{ status: schema }` map keyed by explicit 2xx codes.
   *
   * Constrains the type of `c.json(...)`, the explicit `c.response({ status, data })`
   * factory, and the implicit handler return value. Returning a payload that
   * doesn't satisfy the schema is a type error (and a runtime error if the
   * schema parses fail).
   *
   * @example
   * ```ts
   * .response(UserSchema) // every 2xx returns User
   * .response({ 200: UserSchema, 201: CreatedUserSchema })
   * ```
   */
  response<TResponseSchema extends RouteResponseSchema>(
    schema: TResponseSchema & RouteResponseSchemaInput<TResponseSchema>,
  ): RouteBuilderMethodStage<
    MergeRouteSchemaPatch<TSchema, { response: TResponseSchema }>,
    TMethod,
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TRouteConfig,
    TEffectiveConfig,
    TProcedures
  >;
  /**
   * Declares typed thrown-error contracts (4xx only).
   *
   * Three entry shapes per status:
   * - **Direct schema**: a Zod schema applied to `data`.
   *   `404: z.object({ id: z.string() })`
   * - **Descriptor**: `{ data?, issues?, message? }` for separately-typed
   *   payload + sub-error list + default message.
   *   `404: { data: NotFoundData, issues: z.array(IssueSchema), message: "User not found" }`
   * - **Code map**: `{ CODE: descriptor | schema }` when a single status
   *   represents multiple semantic codes.
   *   `400: { VALIDATION_FAILED: { data: ValidationData, issues: z.array(IssueSchema) } }`
   *
   * Constrains the union accepted by `c.error({ status, code?, data?, ... })`,
   * and validates errors thrown out of the handler against the matching entry.
   *
   * @example
   * ```ts
   * .throws({
   *   404: { data: NotFoundDataSchema, message: "Not found" },
   *   422: {
   *     INVALID_BODY: { data: BodyValidationSchema, issues: z.array(IssueSchema) },
   *     UNPROCESSABLE: { data: UnprocessableSchema },
   *   },
   * })
   * ```
   */
  throws<TThrowsSchema extends RouteThrowsSchemaMap>(
    schema: TThrowsSchema & RouteThrowsSchemaInput<TThrowsSchema>,
  ): RouteBuilderMethodStage<
    MergeRouteSchemaPatch<TSchema, { throws: TThrowsSchema }>,
    TMethod,
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TRouteConfig,
    TEffectiveConfig,
    TProcedures
  >;
  /**
   * Declares a single-file upload contract.
   *
   * The request body is parsed as `multipart/form-data`. The file at
   * `config.fieldName` (default `"file"`) is surfaced on `c.file` (typed as
   * `UploadedFile` or `UploadedFile | undefined` depending on `required`).
   * Remaining non-file form fields are still validated against the declared
   * `body` schema, if any.
   *
   * Cannot coexist with `.files(...)` — runtime throws if both are declared.
   *
   * **Constraint**: GET routes are blocked at type level via `this: never`.
   *
   * @example
   * ```ts
   * .post()
   *   .file({ fieldName: "avatar", maxSize: 5 * 1024 * 1024, allowedTypes: ["image/*"] })
   *   .body(z.object({ caption: z.string().optional() }))
   *   .handle(async (c) => { await uploads.save(c.file); return { ok: true }; });
   * ```
   */
  file<TFileConfig extends FileConfig = FileConfig>(
    this: TMethod extends "get"
      ? never
      : RouteBuilderMethodStage<
          TSchema,
          TMethod,
          TParamsSchema,
          TContextExtensions,
          TFeatures,
          TContextRefinementRules,
          TRouteConfig,
          TEffectiveConfig,
          TProcedures
        >,
    config?: TFileConfig,
  ): RouteBuilderMethodStage<
    MergeRouteSchemaPatch<TSchema, { file: TFileConfig }>,
    TMethod,
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TRouteConfig,
    TEffectiveConfig,
    TProcedures
  >;
  /**
   * Declares a multi-file upload contract.
   *
   * The request body is parsed as `multipart/form-data`. Every file submitted
   * under `config.fieldName` (default `"files"`) is collected into `c.files`
   * (always an array). Remaining non-file form fields are still validated
   * against the declared `body` schema, if any.
   *
   * Cannot coexist with `.file(...)` — runtime throws if both are declared.
   *
   * **Constraint**: GET routes are blocked at type level via `this: never`.
   *
   * @example
   * ```ts
   * .post()
   *   .files({ fieldName: "attachments", maxCount: 10, totalMaxSize: 50 * 1024 * 1024 })
   *   .handle(async (c) => { for (const f of c.files) await uploads.save(f); return { ok: true }; });
   * ```
   */
  files<TFilesConfig extends FilesConfig = FilesConfig>(
    this: TMethod extends "get"
      ? never
      : RouteBuilderMethodStage<
          TSchema,
          TMethod,
          TParamsSchema,
          TContextExtensions,
          TFeatures,
          TContextRefinementRules,
          TRouteConfig,
          TEffectiveConfig,
          TProcedures
        >,
    config?: TFilesConfig,
  ): RouteBuilderMethodStage<
    MergeRouteSchemaPatch<TSchema, { files: TFilesConfig }>,
    TMethod,
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TRouteConfig,
    TEffectiveConfig,
    TProcedures
  >;
  /**
   * Finalizes route registration by attaching a request handler.
   *
   * Returns to the parent stage, so additional methods can be declared on the
   * same path (e.g. add a `.post()` after a `.get()` for the same file).
   *
   * Handler context (`c`):
   * - `c.body` / `c.query` / `c.headers` / `c.params` — validated request data,
   *   typed from the declared schemas. `c.params` is merged from the route
   *   plus every applied procedure (route wins on collision).
   * - `c.file` / `c.files` — populated only when `.file(...)` / `.files(...)` is declared.
   * - `c.procedures` — contributions from every procedure attached via
   *   `.procedure(...)` whose `applyOnMethods` includes this method.
   * - `c.json(payload, status?, headers?)` — JSON response (auto-wrapped in 2xx envelope).
   * - `c.response({ status, data, code?, message?, issues? })` — explicit typed response.
   * - `c.error({ status, code?, data?, message?, issues? })` — typed `ApiError` factory; throw the result.
   * - `c.returns(payload)` — type-only assertion that the implicit return matches the declared schema.
   * - Plus any plugin-contributed fields (e.g. `c.auth`, `c.ratelimiting`).
   *
   * Handler return value:
   * - An object satisfying the response schema (auto-wrapped in 2xx envelope).
   * - The result of `c.response(...)` for an explicit status / metadata.
   * - A raw `Response` to bypass the framework envelope entirely.
   *
   * @example
   * ```ts
   * .get()
   *   .schema({ response: { 200: UserSchema }, throws: { 404: { data: NotFoundData } } })
   *   .handle(async (c) => {
   *     const user = await users.find(c.params.id);
   *     if (!user) throw c.error({ status: 404, data: { id: c.params.id } });
   *     return user; // implicit 200 + envelope
   *   });
   * ```
   */
  handle(
    handler: RouteHandler<
      TSchema,
      TParamsSchema,
      ResolveRouteContextForConfig<
        TContextExtensions,
        TContextRefinementRules,
        TEffectiveConfig
      >,
      InferMergedParamsValue<TProcedures, TParamsSchema>,
      InferAppliedProcedureContributions<TProcedures, TMethod>
    >,
  ): RouteBuilderMethodSelectionStage<
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TRouteConfig,
    TProcedures
  >;
}

/**
 * Initial / re-entry stage of the route builder — the state returned by
 * `server.route()` and re-entered after each `.handle(...)` call.
 *
 * From here, callers configure values shared across every method declared on
 * the route (path params, route-level config, procedures), then pick an HTTP
 * method to enter the {@link RouteBuilderMethodStage}.
 *
 * Stage-level setup (must come BEFORE selecting an HTTP method):
 * - `.params(zodObject)` — path-params schema; merged with procedure params.
 * - `.config(partial)` — defaults for every method on this route.
 * - `.procedure(factory, options?)` — reusable per-request logic.
 *
 * Method selectors (each enters {@link RouteBuilderMethodStage}):
 * - `.get()`, `.post()`, `.put()`, `.patch()`, `.delete()`, `.options()`, `.any()`.
 *
 * After `.handle(...)` registers a method, the chain returns here and you can
 * declare another method on the same path.
 */
export interface RouteBuilderMethodSelectionStage<
  TParamsSchema extends RouteParamsSchema | undefined = undefined,
  TContextExtensions extends object = {},
  TFeatures extends RouteConfigCapabilities = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultConfig extends object = {},
  TProcedures extends readonly AnyAppliedRouteProcedure[] = [],
> {
  /**
   * Declares the path-params schema shared by every method on this route.
   *
   * The schema is merged with each attached procedure's `params` schema
   * (procedure params first, route params last — so route keys win on
   * collision). Mixed sources must all be `z.object(...)` schemas.
   *
   * Validated values are surfaced on `c.params`.
   *
   * Must be called before selecting an HTTP method; calling it after `.get()`
   * (etc.) throws.
   *
   * @example
   * ```ts
   * // src/routes/users/[userId]/posts/[postId]/route.ts
   * server.route()
   *   .params(z.object({ userId: z.coerce.number(), postId: z.coerce.number() }))
   *   .get().handle((c) => ({ userId: c.params.userId, postId: c.params.postId }));
   * ```
   */
  params<TNextParamsSchema extends RouteParamsSchema>(
    schema: TNextParamsSchema,
  ): RouteBuilderMethodSelectionStage<
    TNextParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TProcedures
  >;
  /**
   * Sets route-level config defaults applied to every method declared on this
   * route (and deep-merged with method-level `.config(...)` calls).
   *
   * Precedence: server defaults < route-level (this) < method-level. Multiple
   * route-level calls deep-merge.
   *
   * Must be called before selecting an HTTP method to count as a route-level
   * default; if called after a method is selected, it acts as method-level
   * config (handled by the overload on the {@link RouteBuilder} class).
   *
   * @example `.config({ authentication: { required: true } })`
   */
  config<TNextConfig extends RouteConfig<TFeatures>>(
    config: TNextConfig,
  ): RouteBuilderMethodSelectionStage<
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    DeepMergeObjects<TDefaultConfig, TNextConfig>,
    TProcedures
  >;
  /**
   * Attaches a procedure to every method declared from this builder.
   *
   * - Procedures run in the order attached, after request validation and
   *   before the route handler.
   * - `options.applyOnMethods` narrows which methods execute the procedure;
   *   `c.procedures` types automatically reflect that filter (procedures
   *   excluded for the current method are typed as absent).
   * - The procedure's `paramsSchema` is merged into the route's params schema
   *   regardless of `applyOnMethods` (path params are always present).
   * - Call the factory with use-site config: `userProcedure({ skipOwnershipCheck: true })`.
   *
   * Must be called before selecting an HTTP method.
   *
   * @example
   * ```ts
   * server.route()
   *   .procedure(userProcedure())
   *   .procedure(adminGuard(), { applyOnMethods: ["delete"] })
   *   .get().handle((c) => c.procedures.user)
   *   .delete().handle(async (c) => { await users.remove(c.procedures.user.id); });
   * ```
   */
  procedure<
    TProcedure extends AnyRouteProcedureDefinition,
    TMethods extends readonly RouteMethod[] | undefined = undefined,
  >(
    procedure: TProcedure,
    options?: RouteProcedureApplyOptions<TMethods>,
  ): RouteBuilderMethodSelectionStage<
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    readonly [...TProcedures, AppliedRouteProcedure<TProcedure, TMethods>]
  >;
  /**
   * Selects a wildcard route that matches every HTTP method on this path.
   *
   * Useful for catch-all proxies, OPTIONS handlers, or shared response
   * shapers. Equivalent to Hono's `app.all(...)`.
   *
   * @example `server.route().any().handle((c) => c.text("ok"));`
   */
  any(): RouteBuilderMethodStage<
    {},
    "any",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig,
    TProcedures
  >;
  /**
   * Selects an HTTP `GET` route.
   *
   * GET-specific constraints enforced at type level:
   * - No request body (`.body()` / `body` in `.schema()`).
   * - No file uploads (`.file()` / `.files()`).
   *
   * @example `server.route().get().schema({ response: UserSchema }).handle((c) => user);`
   */
  get(): RouteBuilderMethodStage<
    {},
    "get",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig,
    TProcedures
  >;
  /**
   * Selects an HTTP `POST` route.
   *
   * Typically used for resource creation. Supports body validation and file
   * uploads (single via `.file(...)` or multi via `.files(...)`).
   *
   * @example
   * ```ts
   * server.route()
   *   .post()
   *   .body(z.object({ name: z.string() }))
   *   .schema({ response: { 201: UserSchema } })
   *   .handle(async (c) => c.response({ status: 201, data: await users.create(c.body) }));
   * ```
   */
  post(): RouteBuilderMethodStage<
    {},
    "post",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig,
    TProcedures
  >;
  /**
   * Selects an HTTP `PUT` route.
   *
   * Typically used for full-resource replacement (idempotent). Supports body
   * validation and file uploads.
   *
   * @example
   * ```ts
   * server.route()
   *   .put()
   *   .body(UserSchema)
   *   .handle(async (c) => users.replace(c.params.id, c.body));
   * ```
   */
  put(): RouteBuilderMethodStage<
    {},
    "put",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig,
    TProcedures
  >;
  /**
   * Selects an HTTP `PATCH` route.
   *
   * Typically used for partial-resource update. Supports body validation and
   * file uploads.
   *
   * @example
   * ```ts
   * server.route()
   *   .patch()
   *   .body(z.object({ name: z.string().optional() }))
   *   .handle(async (c) => users.update(c.params.id, c.body));
   * ```
   */
  patch(): RouteBuilderMethodStage<
    {},
    "patch",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig,
    TProcedures
  >;
  /**
   * Selects an HTTP `DELETE` route.
   *
   * Typically used for resource deletion. Supports body validation when the
   * client needs to send confirmation payloads.
   *
   * @example
   * ```ts
   * server.route()
   *   .delete()
   *   .handle(async (c) => { await users.remove(c.params.id); return c.response({ status: 204, data: undefined }); });
   * ```
   */
  delete(): RouteBuilderMethodStage<
    {},
    "delete",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig,
    TProcedures
  >;
  /**
   * Selects an HTTP `OPTIONS` route.
   *
   * Typically used for explicit CORS preflight responses or to advertise
   * allowed methods. Most apps rely on the {@link CorsPlugin} instead.
   *
   * @example
   * ```ts
   * server.route()
   *   .options()
   *   .handle((c) => new Response(null, { headers: { Allow: "GET, POST" } }));
   * ```
   */
  options(): RouteBuilderMethodStage<
    {},
    "options",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig,
    TProcedures
  >;
}

/**
 * Concrete implementation backing both {@link RouteBuilderMethodSelectionStage}
 * and {@link RouteBuilderMethodStage}.
 *
 * The class itself uses a small state machine: `pendingMethod` is set when an
 * HTTP method selector (`.get()`, `.post()`, ...) runs and is cleared by
 * `.handle(...)`. While set, the builder is in the "method stage"; while
 * cleared, it is in the "selection stage". The fluent interfaces narrow
 * which methods are visible to callers in each phase.
 *
 * Most callers should not interact with this class directly — use
 * `server.route()` (which returns the typed selection-stage interface) and
 * let TypeScript infer the rest of the chain.
 */
export class RouteBuilder<
  TParamsSchema extends RouteParamsSchema | undefined = undefined,
  TContextExtensions extends object = {},
  TFeatures extends RouteConfigCapabilities = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultConfig extends object = {},
> {
  private pendingMethod: RouteMethod | null = null;
  private pendingDescription: string | null = null;
  private pendingSchema: RouteSchema | null = null;
  private pendingConfig: RouteConfig<TFeatures> | null = null;
  private defaultConfig: RouteConfig<TFeatures> = {};
  private defaultParamsSchema: RouteParamsSchema | undefined = undefined;
  private readonly appliedProcedures: AnyAppliedRouteProcedure[] = [];

  public constructor(
    private readonly register: RouteRegistration<TContextExtensions, TFeatures>,
  ) {}

  public procedure<
    TProcedure extends AnyRouteProcedureDefinition,
    TMethods extends readonly RouteMethod[] | undefined = undefined,
  >(
    procedure: TProcedure,
    options?: RouteProcedureApplyOptions<TMethods>,
  ): RouteBuilderMethodSelectionStage<
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    // Class cannot carry accumulated TProcedures in its own generics; the
    // interface overload drives the caller-visible tuple via `as unknown as`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
  > {
    if (this.pendingMethod) {
      throw new Error(
        "Invalid route chain: call .procedure(...) before selecting an HTTP method.",
      );
    }

    this.appliedProcedures.push({
      procedure,
      applyOnMethods: options?.applyOnMethods,
    });

    return this as unknown as RouteBuilderMethodSelectionStage<
      TParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >;
  }

  public config<TNextConfig extends RouteConfig<TFeatures>>(
    config: TNextConfig,
  ): RouteBuilderMethodSelectionStage<
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    DeepMergeObjects<TDefaultConfig, TNextConfig>
  >;
  public config<
    TSchema extends RouteSchema,
    TMethod extends RouteMethod,
    TMethodParamsSchema extends RouteParamsSchema | undefined,
    TRouteConfig extends object,
    TEffectiveConfig extends object,
    TNextConfig extends RouteConfig<TFeatures>,
  >(
    this: RouteBuilder<
      TParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TRouteConfig
    > &
      RouteBuilderMethodStage<
        TSchema,
        TMethod,
        TMethodParamsSchema,
        TContextExtensions,
        TFeatures,
        TContextRefinementRules,
        TRouteConfig,
        TEffectiveConfig
      >,
    config: TNextConfig,
  ): RouteBuilderMethodStage<
    TSchema,
    TMethod,
    TMethodParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TRouteConfig,
    DeepMergeObjects<TEffectiveConfig, TNextConfig>
  >;
  public config<TNextConfig extends RouteConfig<TFeatures>>(
    config: TNextConfig,
  ): unknown {
    if (this.pendingMethod) {
      this.pendingConfig = mergeRouteConfig(this.pendingConfig ?? {}, config);
      return this;
    }

    this.defaultConfig = mergeRouteConfig(this.defaultConfig, config);
    return this as unknown as RouteBuilderMethodSelectionStage<
      TParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      DeepMergeObjects<TDefaultConfig, TNextConfig>
    >;
  }

  public params<TNextParamsSchema extends RouteParamsSchema>(
    schema: TNextParamsSchema,
  ): RouteBuilderMethodSelectionStage<
    TNextParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig
  > {
    if (this.pendingMethod) {
      throw new Error(
        "Invalid route chain: call .params(...) before selecting an HTTP method.",
      );
    }

    this.defaultParamsSchema = schema;
    return this as unknown as RouteBuilderMethodSelectionStage<
      TNextParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig
    >;
  }

  public any(): RouteBuilderMethodStage<
    {},
    "any",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  > {
    return this.selectMethod("any");
  }

  public get(): RouteBuilderMethodStage<
    {},
    "get",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  > {
    return this.selectMethod("get");
  }

  public post(): RouteBuilderMethodStage<
    {},
    "post",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  > {
    return this.selectMethod("post");
  }

  public put(): RouteBuilderMethodStage<
    {},
    "put",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  > {
    return this.selectMethod("put");
  }

  public patch(): RouteBuilderMethodStage<
    {},
    "patch",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  > {
    return this.selectMethod("patch");
  }

  public delete(): RouteBuilderMethodStage<
    {},
    "delete",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  > {
    return this.selectMethod("delete");
  }

  public options(): RouteBuilderMethodStage<
    {},
    "options",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  > {
    return this.selectMethod("options");
  }

  public schema<
    TCurrentSchema extends RouteSchema,
    TMethod extends RouteMethod,
    TMethodParamsSchema extends RouteParamsSchema | undefined,
    TNextSchema extends RouteSchemaDefinitionForMethod<TMethod>,
    TEffectiveConfig extends object,
  >(
    this: RouteBuilder<
      TParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig
    > &
      RouteBuilderMethodStage<
        TCurrentSchema,
        TMethod,
        TMethodParamsSchema,
        TContextExtensions,
        TFeatures,
        TContextRefinementRules,
        TDefaultConfig,
        TEffectiveConfig
      >,
    schema: TNextSchema & RouteSchemaDefinitionForMethod<TMethod>,
  ): RouteBuilderMethodStage<
    TNextSchema,
    TMethod,
    TMethodParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TEffectiveConfig
  > {
    this.assertPendingMethod("schema");
    if (this.pendingMethod === "get" && "body" in schema && schema.body !== undefined) {
      throw new Error("GET routes cannot define a request body schema.");
    }
    if (
      this.pendingMethod === "get" &&
      (("file" in schema && schema.file !== undefined) ||
        ("files" in schema && schema.files !== undefined))
    ) {
      throw new Error("GET routes cannot accept file uploads.");
    }
    if (
      "file" in schema &&
      schema.file !== undefined &&
      "files" in schema &&
      schema.files !== undefined
    ) {
      throw new Error(
        "Cannot declare both file and files on the same route — choose one.",
      );
    }
    // Merge so `.file()` / `.body()` / etc. are not wiped when followed by `.schema({ ... })`.
    this.pendingSchema = { ...(this.pendingSchema ?? {}), ...schema };
    return this as unknown as RouteBuilderMethodStage<
      TNextSchema,
      TMethod,
      TMethodParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig,
      TEffectiveConfig
    >;
  }

  public body<
    TCurrentSchema extends RouteSchema,
    TMethod extends RouteMethod,
    TMethodParamsSchema extends RouteParamsSchema | undefined,
    TBodySchema extends z.ZodTypeAny,
    TEffectiveConfig extends object,
  >(
    this: TMethod extends "get"
      ? never
      : RouteBuilder<
          TParamsSchema,
          TContextExtensions,
          TFeatures,
          TContextRefinementRules,
          TDefaultConfig
        > &
          RouteBuilderMethodStage<
            TCurrentSchema,
            TMethod,
            TMethodParamsSchema,
            TContextExtensions,
            TFeatures,
            TContextRefinementRules,
            TDefaultConfig,
            TEffectiveConfig
          >,
    schema: TBodySchema,
  ): RouteBuilderMethodStage<
    MergeRouteSchemaPatch<TCurrentSchema, { body: TBodySchema }>,
    TMethod,
    TMethodParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TEffectiveConfig
  > {
    this.assertPendingMethod("body");
    this.applySchemaPatch({ body: schema });
    return this as unknown as RouteBuilderMethodStage<
      MergeRouteSchemaPatch<TCurrentSchema, { body: TBodySchema }>,
      TMethod,
      TMethodParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig,
      TEffectiveConfig
    >;
  }

  public query<
    TCurrentSchema extends RouteSchema,
    TMethod extends RouteMethod,
    TMethodParamsSchema extends RouteParamsSchema | undefined,
    TQuerySchema extends z.ZodTypeAny,
    TEffectiveConfig extends object,
  >(
    this: RouteBuilder<
      TParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig
    > &
      RouteBuilderMethodStage<
        TCurrentSchema,
        TMethod,
        TMethodParamsSchema,
        TContextExtensions,
        TFeatures,
        TContextRefinementRules,
        TDefaultConfig,
        TEffectiveConfig
      >,
    schema: TQuerySchema,
  ): RouteBuilderMethodStage<
    MergeRouteSchemaPatch<TCurrentSchema, { query: TQuerySchema }>,
    TMethod,
    TMethodParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TEffectiveConfig
  > {
    this.assertPendingMethod("query");
    this.applySchemaPatch({ query: schema });
    return this as unknown as RouteBuilderMethodStage<
      MergeRouteSchemaPatch<TCurrentSchema, { query: TQuerySchema }>,
      TMethod,
      TMethodParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig,
      TEffectiveConfig
    >;
  }

  public headers<
    TCurrentSchema extends RouteSchema,
    TMethod extends RouteMethod,
    TMethodParamsSchema extends RouteParamsSchema | undefined,
    THeadersSchema extends z.ZodTypeAny,
    TEffectiveConfig extends object,
  >(
    this: RouteBuilder<
      TParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig
    > &
      RouteBuilderMethodStage<
        TCurrentSchema,
        TMethod,
        TMethodParamsSchema,
        TContextExtensions,
        TFeatures,
        TContextRefinementRules,
        TDefaultConfig,
        TEffectiveConfig
      >,
    schema: THeadersSchema,
  ): RouteBuilderMethodStage<
    MergeRouteSchemaPatch<TCurrentSchema, { headers: THeadersSchema }>,
    TMethod,
    TMethodParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TEffectiveConfig
  > {
    this.assertPendingMethod("headers");
    this.applySchemaPatch({ headers: schema });
    return this as unknown as RouteBuilderMethodStage<
      MergeRouteSchemaPatch<TCurrentSchema, { headers: THeadersSchema }>,
      TMethod,
      TMethodParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig,
      TEffectiveConfig
    >;
  }

  public response<
    TCurrentSchema extends RouteSchema,
    TMethod extends RouteMethod,
    TMethodParamsSchema extends RouteParamsSchema | undefined,
    TResponseSchema extends RouteResponseSchema,
    TEffectiveConfig extends object,
  >(
    this: RouteBuilder<
      TParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig
    > &
      RouteBuilderMethodStage<
        TCurrentSchema,
        TMethod,
        TMethodParamsSchema,
        TContextExtensions,
        TFeatures,
        TContextRefinementRules,
        TDefaultConfig,
        TEffectiveConfig
      >,
    schema: TResponseSchema & RouteResponseSchemaInput<TResponseSchema>,
  ): RouteBuilderMethodStage<
    MergeRouteSchemaPatch<TCurrentSchema, { response: TResponseSchema }>,
    TMethod,
    TMethodParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TEffectiveConfig
  > {
    this.assertPendingMethod("response");
    this.applySchemaPatch({ response: schema as TResponseSchema });
    return this as unknown as RouteBuilderMethodStage<
      MergeRouteSchemaPatch<TCurrentSchema, { response: TResponseSchema }>,
      TMethod,
      TMethodParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig,
      TEffectiveConfig
    >;
  }

  public file<
    TCurrentSchema extends RouteSchema,
    TMethod extends RouteMethod,
    TMethodParamsSchema extends RouteParamsSchema | undefined,
    TFileConfig extends FileConfig,
    TEffectiveConfig extends object,
  >(
    this: TMethod extends "get"
      ? never
      : RouteBuilder<
          TParamsSchema,
          TContextExtensions,
          TFeatures,
          TContextRefinementRules,
          TDefaultConfig
        > &
          RouteBuilderMethodStage<
            TCurrentSchema,
            TMethod,
            TMethodParamsSchema,
            TContextExtensions,
            TFeatures,
            TContextRefinementRules,
            TDefaultConfig,
            TEffectiveConfig
          >,
    config?: TFileConfig,
  ): RouteBuilderMethodStage<
    MergeRouteSchemaPatch<TCurrentSchema, { file: TFileConfig }>,
    TMethod,
    TMethodParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TEffectiveConfig
  > {
    this.assertPendingMethod("file");
    this.applySchemaPatch({ file: (config ?? {}) as FileConfig });
    return this as unknown as RouteBuilderMethodStage<
      MergeRouteSchemaPatch<TCurrentSchema, { file: TFileConfig }>,
      TMethod,
      TMethodParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig,
      TEffectiveConfig
    >;
  }

  public files<
    TCurrentSchema extends RouteSchema,
    TMethod extends RouteMethod,
    TMethodParamsSchema extends RouteParamsSchema | undefined,
    TFilesConfig extends FilesConfig,
    TEffectiveConfig extends object,
  >(
    this: TMethod extends "get"
      ? never
      : RouteBuilder<
          TParamsSchema,
          TContextExtensions,
          TFeatures,
          TContextRefinementRules,
          TDefaultConfig
        > &
          RouteBuilderMethodStage<
            TCurrentSchema,
            TMethod,
            TMethodParamsSchema,
            TContextExtensions,
            TFeatures,
            TContextRefinementRules,
            TDefaultConfig,
            TEffectiveConfig
          >,
    config?: TFilesConfig,
  ): RouteBuilderMethodStage<
    MergeRouteSchemaPatch<TCurrentSchema, { files: TFilesConfig }>,
    TMethod,
    TMethodParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TEffectiveConfig
  > {
    this.assertPendingMethod("files");
    this.applySchemaPatch({ files: (config ?? {}) as FilesConfig });
    return this as unknown as RouteBuilderMethodStage<
      MergeRouteSchemaPatch<TCurrentSchema, { files: TFilesConfig }>,
      TMethod,
      TMethodParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig,
      TEffectiveConfig
    >;
  }

  public throws<
    TCurrentSchema extends RouteSchema,
    TMethod extends RouteMethod,
    TMethodParamsSchema extends RouteParamsSchema | undefined,
    TThrowsSchema extends RouteThrowsSchemaMap,
    TEffectiveConfig extends object,
  >(
    this: RouteBuilder<
      TParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig
    > &
      RouteBuilderMethodStage<
        TCurrentSchema,
        TMethod,
        TMethodParamsSchema,
        TContextExtensions,
        TFeatures,
        TContextRefinementRules,
        TDefaultConfig,
        TEffectiveConfig
      >,
    schema: TThrowsSchema & RouteThrowsSchemaInput<TThrowsSchema>,
  ): RouteBuilderMethodStage<
    MergeRouteSchemaPatch<TCurrentSchema, { throws: TThrowsSchema }>,
    TMethod,
    TMethodParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TEffectiveConfig
  > {
    this.assertPendingMethod("throws");
    this.applySchemaPatch({ throws: schema as TThrowsSchema });
    return this as unknown as RouteBuilderMethodStage<
      MergeRouteSchemaPatch<TCurrentSchema, { throws: TThrowsSchema }>,
      TMethod,
      TMethodParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig,
      TEffectiveConfig
    >;
  }

  public handle<
    TSchema extends RouteSchema,
    TMethod extends RouteMethod,
    TMethodParamsSchema extends RouteParamsSchema | undefined,
    TEffectiveConfig extends object,
  >(
    this: RouteBuilder<
      TParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig
    > &
      RouteBuilderMethodStage<
        TSchema,
        TMethod,
        TMethodParamsSchema,
        TContextExtensions,
        TFeatures,
        TContextRefinementRules,
        TDefaultConfig,
        TEffectiveConfig
      >,
    handler: RouteHandler<
      TSchema,
      TMethodParamsSchema,
      ResolveRouteContextForConfig<
        TContextExtensions,
        TContextRefinementRules,
        TEffectiveConfig
      >
    >,
  ): RouteBuilderMethodSelectionStage<
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig
  > {
    if (!this.pendingMethod) {
      throw new Error(
        "Invalid route chain: call an HTTP method first. Example: server.route().get().handle((c) => c.text('ok')).",
      );
    }

    this.register({
      method: this.pendingMethod,
      handle: handler as unknown as RouteHandler<RouteSchema, RouteParamsSchema>,
      params: this.defaultParamsSchema as TMethodParamsSchema,
      description: this.pendingDescription ?? undefined,
      schema:
        this.pendingSchema && Object.keys(this.pendingSchema).length > 0
          ? this.pendingSchema
          : undefined,
      config: mergeRouteConfig<TFeatures>(this.defaultConfig, this.pendingConfig ?? {}),
      procedures:
        this.appliedProcedures.length > 0
          ? [...this.appliedProcedures]
          : undefined,
    });

    this.pendingMethod = null;
    this.pendingDescription = null;
    this.pendingSchema = null;
    this.pendingConfig = null;
    return this;
  }

  public describe<
    TSchema extends RouteSchema,
    TMethod extends RouteMethod,
    TMethodParamsSchema extends RouteParamsSchema | undefined,
    TEffectiveConfig extends object,
  >(
    this: RouteBuilder<
      TParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig
    > &
      RouteBuilderMethodStage<
        TSchema,
        TMethod,
        TMethodParamsSchema,
        TContextExtensions,
        TFeatures,
        TContextRefinementRules,
        TDefaultConfig,
        TEffectiveConfig
      >,
    description: string,
  ): RouteBuilderMethodStage<
    TSchema,
    TMethod,
    TMethodParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TEffectiveConfig
  > {
    this.assertPendingMethod("describe");

    this.pendingDescription = description;
    return this;
  }

  private selectMethod<TMethod extends RouteMethod>(
    method: TMethod,
  ): RouteBuilderMethodStage<
    {},
    TMethod,
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  > {
    if (this.pendingMethod) {
      throw new Error(
        `Invalid route chain: .${this.pendingMethod}() must be followed by .handle(...) before selecting another method. Example: server.route().${this.pendingMethod}().handle((c) => c.text('ok')).`,
      );
    }

    this.pendingMethod = method;
    this.pendingDescription = null;
    this.pendingSchema = null;
    this.pendingConfig = null;
    return this as unknown as RouteBuilderMethodStage<
      {},
      TMethod,
      TParamsSchema,
      TContextExtensions,
      TFeatures,
      TContextRefinementRules,
      TDefaultConfig,
      TDefaultConfig
    >;
  }

  private assertPendingMethod(caller: string): void {
    if (!this.pendingMethod) {
      throw new Error(
        `Invalid route chain: call an HTTP method before .${caller}(...). Example: server.route().get().${caller === "describe" ? "describe('description')." : `${caller}(/* schema */).`}handle((c) => c.text('ok')).`,
      );
    }
  }

  private applySchemaPatch(schemaPatch: Partial<RouteSchema>): void {
    if (this.pendingMethod === "get" && schemaPatch.body !== undefined) {
      throw new Error("GET routes cannot define a request body schema.");
    }
    if (
      this.pendingMethod === "get" &&
      (schemaPatch.file !== undefined || schemaPatch.files !== undefined)
    ) {
      throw new Error("GET routes cannot accept file uploads.");
    }
    if (schemaPatch.file !== undefined && this.pendingSchema?.files !== undefined) {
      throw new Error(
        "Cannot combine .file(...) and .files(...) on the same route — choose one.",
      );
    }
    if (schemaPatch.files !== undefined && this.pendingSchema?.file !== undefined) {
      throw new Error(
        "Cannot combine .file(...) and .files(...) on the same route — choose one.",
      );
    }
    this.pendingSchema = {
      ...(this.pendingSchema ?? {}),
      ...schemaPatch,
    };
  }
}

/**
 * Creates a fresh route builder.
 *
 * Internal-ish — `server.route()` calls this to wire the registration callback
 * to the current source file. Callers building custom integrations can use
 * this factory directly with their own `register` function.
 */
export function createRouteBuilder(
  register: RouteRegistration,
): RouteBuilderMethodSelectionStage;
export function createRouteBuilder<
  TContextExtensions extends object,
  TFeatures extends RouteConfigCapabilities,
  TContextRefinementRules extends ContextRefinementRule,
  TInitialRouteDefaults extends object = {},
>(
  register: RouteRegistration<TContextExtensions, TFeatures>,
): RouteBuilderMethodSelectionStage<
  undefined,
  TContextExtensions,
  TFeatures,
  TContextRefinementRules,
  TInitialRouteDefaults
>;
export function createRouteBuilder<
  TContextExtensions extends object,
  TFeatures extends RouteConfigCapabilities,
  TContextRefinementRules extends ContextRefinementRule,
  TInitialRouteDefaults extends object = {},
>(
  register: RouteRegistration<TContextExtensions, TFeatures>,
): RouteBuilderMethodSelectionStage<
  undefined,
  TContextExtensions,
  TFeatures,
  TContextRefinementRules,
  TInitialRouteDefaults
> {
  return new RouteBuilder<
    undefined,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TInitialRouteDefaults
  >(register);
}
