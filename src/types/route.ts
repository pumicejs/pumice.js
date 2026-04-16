import type {
  ExplicitRouteResponse,
  InferRouteResponsePayload,
  RouteParamsSchema,
  RouteSchema,
  Simplify,
  TypedRouteContext,
} from "./schema.js";
import type { RouteConfig } from "./config.js";
import type { Context } from "hono";
import type { z } from "zod";

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
> = (
  context: TypedRouteContext<TSchema, TParamsSchema, TContextExtensions>,
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
