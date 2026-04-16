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

export interface RouteBuilderMethodStage<
  TSchema extends RouteSchema = {},
  TMethod extends RouteMethod = RouteMethod,
  TParamsSchema extends RouteParamsSchema | undefined = undefined,
  TContextExtensions extends object = {},
  TFeatures extends RouteConfigCapabilities = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TRouteConfig extends object = {},
  TEffectiveConfig extends object = TRouteConfig,
> {
  /**
   * Sets request body validation schema.
   *
   * GET routes are blocked at type level via `this: never`.
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
          TEffectiveConfig
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
    TEffectiveConfig
  >;
  /**
   * Applies per-method runtime config.
   *
   * This config is merged with route-level defaults from `.route().config(...)`.
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
    DeepMergeObjects<TEffectiveConfig, TNextConfig>
  >;
  /**
   * Attaches human-readable metadata to the route.
   *
   * Useful for generated docs and route inspection UIs.
   */
  describe(description: string): RouteBuilderMethodStage<
    TSchema,
    TMethod,
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TRouteConfig,
    TEffectiveConfig
  >;
  /**
   * Replaces the current route schema in one call.
   *
   * Available keys:
   * - `body`, `query`, `headers`
   * - `response` (2xx schemas only)
   * - `throws` (4xx schemas only; supports descriptor/code-map entries)
   *
   * Example:
   * `schema({ query, response: { 200: User }, throws: { 404: { data: NotFoundData, message: "User not found" } } })`
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
    TEffectiveConfig
  >;
  /**
   * Sets query-string validation schema.
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
    TEffectiveConfig
  >;
  /**
   * Sets request headers validation schema.
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
    TEffectiveConfig
  >;
  /**
   * Declares successful response schema(s).
   *
   * Use either one schema for all 2xx responses, or a status map like:
   * `{ 200: SuccessSchema, 201: CreatedSchema }`
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
    TEffectiveConfig
  >;
  /**
   * Declares typed thrown error shapes for 4xx statuses.
   *
   * Example:
   * `throws({ 404: { data: NotFoundData, issues: z.array(z.object({ path: z.array(z.string()), message: z.string() })) } })`
   *
   * You can also map by code:
   * `throws({ 400: { VALIDATION_FAILED: { data: ValidationData, issues: z.array(IssueSchema) } } })`
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
    TEffectiveConfig
  >;
  /**
   * Finalizes route registration with a handler.
   */
  handle(
    handler: RouteHandler<
      TSchema,
      TParamsSchema,
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
    TRouteConfig
  >;
}

export interface RouteBuilderMethodSelectionStage<
  TParamsSchema extends RouteParamsSchema | undefined = undefined,
  TContextExtensions extends object = {},
  TFeatures extends RouteConfigCapabilities = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultConfig extends object = {},
> {
  /**
   * Sets route-level params schema for all methods from this builder.
   */
  params<TNextParamsSchema extends RouteParamsSchema>(
    schema: TNextParamsSchema,
  ): RouteBuilderMethodSelectionStage<
    TNextParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig
  >;
  /**
   * Applies runtime config defaults for all methods registered from this builder.
   */
  config<TNextConfig extends RouteConfig<TFeatures>>(
    config: TNextConfig,
  ): RouteBuilderMethodSelectionStage<
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    DeepMergeObjects<TDefaultConfig, TNextConfig>
  >;
  /**
   * Registers an `any` method route.
   */
  any(): RouteBuilderMethodStage<
    {},
    "any",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  >;
  /**
   * Registers a `GET` route.
   */
  get(): RouteBuilderMethodStage<
    {},
    "get",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  >;
  /**
   * Registers a `POST` route.
   */
  post(): RouteBuilderMethodStage<
    {},
    "post",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  >;
  /**
   * Registers a `PUT` route.
   */
  put(): RouteBuilderMethodStage<
    {},
    "put",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  >;
  /**
   * Registers a `PATCH` route.
   */
  patch(): RouteBuilderMethodStage<
    {},
    "patch",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  >;
  /**
   * Registers a `DELETE` route.
   */
  delete(): RouteBuilderMethodStage<
    {},
    "delete",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  >;
  /**
   * Registers an `OPTIONS` route.
   */
  options(): RouteBuilderMethodStage<
    {},
    "options",
    TParamsSchema,
    TContextExtensions,
    TFeatures,
    TContextRefinementRules,
    TDefaultConfig,
    TDefaultConfig
  >;
}

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

  public constructor(
    private readonly register: RouteRegistration<TContextExtensions, TFeatures>,
  ) {}

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
    this.pendingSchema = { ...schema };
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
    this.pendingSchema = {
      ...(this.pendingSchema ?? {}),
      ...schemaPatch,
    };
  }
}

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
