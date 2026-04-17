import type {
  ExplicitRouteResponse,
  InferRouteResponsePayload,
  RouteParamsSchema,
  RouteSchema,
  Simplify,
  TypedRouteContextWithParamsValue,
} from "./schema.js";
import type { RouteConfig } from "./config.js";
import type { AnyAppliedRouteProcedure } from "./procedure.js";
import type { Context } from "hono";
import type { z } from "zod";

type InferParamsValue<TParamsSchema extends RouteParamsSchema | undefined> =
  TParamsSchema extends z.ZodTypeAny ? z.infer<TParamsSchema> : unknown;

export type RouteMethod =
  | "any"
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "options";

type RouteImplicitReturnPayload<TSchema extends RouteSchema> = [
  TSchema["response"],
] extends [undefined]
  ? unknown
  : InferRouteResponsePayload<TSchema["response"]>;

type RouteHandlerReturn<TSchema extends RouteSchema> = Simplify<
  | RouteImplicitReturnPayload<TSchema>
  | ExplicitRouteResponse<TSchema["response"]>
  | Response
>;

export type RouteHandler<
  TSchema extends RouteSchema = {},
  TParamsSchema extends RouteParamsSchema | undefined = undefined,
  TContextExtensions extends object = {},
  TParamsValue = InferParamsValue<TParamsSchema>,
  TProcedures extends object = {},
> = (
  context: TypedRouteContextWithParamsValue<
    TSchema,
    TParamsValue,
    TProcedures,
    TContextExtensions
  >,
) => RouteHandlerReturn<TSchema> | Promise<RouteHandlerReturn<TSchema>>;

export type RouteBeforeValidationHook<
  TRouteConfigExtensions extends object = {},
> = {
  order?: number;
  run(
    context: Context,
    routeConfig: RouteConfig<TRouteConfigExtensions> | undefined,
  ): void | Response | Promise<void | Response>;
};

/**
 * Internal route registration unit.
 */
export type RouteDefinition<
  TSchema extends RouteSchema = {},
  TParamsSchema extends RouteParamsSchema | undefined = undefined,
  TContextExtensions extends object = {},
  TRouteConfigExtensions extends object = {},
> = {
  method: RouteMethod;
  handle: RouteHandler<TSchema, TParamsSchema, TContextExtensions>;
  /**
   * Optional route-level params schema declared by `.route().params(...)`.
   */
  params?: TParamsSchema;
  /**
   * Optional schema contract declared by `.schema(...)` or specialized schema methods.
   */
  schema?: TSchema;
  /**
   * Optional human-readable description from `.describe(...)`.
   */
  description?: string;
  /**
   * Optional merged runtime config (route-level + method-level).
   *
   * Method-level config takes precedence over route-level defaults.
   */
  config?: RouteConfig<TRouteConfigExtensions>;
  /**
   * Optional hooks that execute before request validation.
   *
   * Lower `order` values run first.
   * Returning a `Response` short-circuits the route pipeline.
   */
  beforeValidationHooks?: RouteBeforeValidationHook<TRouteConfigExtensions>[];
  /**
   * Procedures applied to this route via `route().procedure(...)`.
   *
   * Runs in declaration order after request validation and before the route
   * handler. Return values are merged into `c.procedures`. Entries whose
   * `applyOnMethods` excludes the route's method are skipped.
   */
  procedures?: AnyAppliedRouteProcedure[];
};

export type RouteRegistration<
  TContextExtensions extends object = {},
  TRouteConfigExtensions extends object = {},
> = <
  TSchema extends RouteSchema,
  TParamsSchema extends z.ZodTypeAny | undefined = undefined,
>(
  definition: RouteDefinition<
    TSchema,
    TParamsSchema,
    TContextExtensions,
    TRouteConfigExtensions
  >,
) => void;
