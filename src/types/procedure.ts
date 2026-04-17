import type { Context } from "hono";
import type { z } from "zod";
import type { RouteMethod } from "./route.js";
import type { Simplify } from "./schema.js";

/**
 * Schema type accepted by `.params(...)` on a procedure builder.
 */
export type ProcedureParamsSchema = z.ZodTypeAny;

/**
 * Return shape allowed from a procedure's `.handle(...)`.
 *
 * Returning `void`/`undefined` contributes nothing to `c.procedures`.
 */
export type ProcedureContributions = object | void | undefined;

type RequiredKeys<T> = {
  [TKey in keyof T]-?: {} extends Pick<T, TKey> ? never : TKey;
}[keyof T];

type ProcedureFactoryArgs<TConfig extends object> = [
  RequiredKeys<TConfig>,
] extends [never]
  ? [config?: TConfig]
  : [config: TConfig];

/**
 * Inferred value of a procedure's params schema.
 *
 * Undefined schema → `{}` (so params merge cleanly via intersection).
 */
export type InferProcedureParamsValue<
  TParamsSchema extends ProcedureParamsSchema | undefined,
> = TParamsSchema extends z.ZodTypeAny ? z.infer<TParamsSchema> : {};

/**
 * Context passed to a procedure handler.
 *
 * Includes server-wide extensions (`TBaseContext`, e.g. `c.auth`), the
 * procedure's own validated params, and the config provided at use-site.
 */
export type RouteProcedureHandlerContext<
  TConfig extends object,
  TParamsSchema extends ProcedureParamsSchema | undefined,
  TBaseContext extends object,
> = Simplify<
  Omit<Context, "json" | "body" | "error"> & {
    params: InferProcedureParamsValue<TParamsSchema>;
    config: TConfig;
  } & TBaseContext
>;

export type RouteProcedureHandler<
  TConfig extends object = {},
  TParamsSchema extends ProcedureParamsSchema | undefined = undefined,
  TContributions extends ProcedureContributions = void,
  TBaseContext extends object = {},
> = (
  context: RouteProcedureHandlerContext<TConfig, TParamsSchema, TBaseContext>,
) => TContributions | Promise<TContributions>;

/**
 * Runtime shape of a procedure, ready to be applied on a route.
 *
 * Produced by calling the factory returned from `procedure().handle(...)`.
 *
 * Method filtering is applied per-route via `route().procedure(proc, { applyOnMethods })`,
 * not here — the same procedure can apply to different methods on different routes.
 */
export type RouteProcedureDefinition<
  TConfig extends object = {},
  TParamsSchema extends ProcedureParamsSchema | undefined = undefined,
  TContributions extends object = {},
  TBaseContext extends object = {},
> = {
  config: TConfig;
  paramsSchema?: TParamsSchema;
  handler: RouteProcedureHandler<
    TConfig,
    TParamsSchema,
    TContributions | void,
    TBaseContext
  >;
  /** Phantom carrier for contribution type — never populated at runtime. */
  readonly _contributions?: TContributions;
};

/**
 * Return type of `procedure()....handle(...)`. Callable with (optional) config
 * to yield a concrete `RouteProcedureDefinition`.
 */
export type RouteProcedureFactory<
  TConfig extends object = {},
  TParamsSchema extends ProcedureParamsSchema | undefined = undefined,
  TContributions extends object = {},
  TBaseContext extends object = {},
> = (
  ...args: ProcedureFactoryArgs<TConfig>
) => RouteProcedureDefinition<
  TConfig,
  TParamsSchema,
  TContributions,
  TBaseContext
>;

/**
 * Widest-type alias used when accumulating procedures on the route builder.
 */
export type AnyRouteProcedureDefinition = RouteProcedureDefinition<
  any,
  any,
  any,
  any
>;

/**
 * A procedure attached to a specific route, optionally scoped to a subset of
 * HTTP methods via `{ applyOnMethods }`.
 *
 * Accumulated in a tuple on the route builder — execution order mirrors
 * attachment order.
 */
export type AppliedRouteProcedure<
  TProcedure extends AnyRouteProcedureDefinition = AnyRouteProcedureDefinition,
  TMethods extends readonly RouteMethod[] | undefined = undefined,
> = {
  procedure: TProcedure;
  applyOnMethods?: TMethods;
};

export type AnyAppliedRouteProcedure = AppliedRouteProcedure<any, any>;

/**
 * Options accepted by `route().procedure(procedure, options?)`.
 */
export type RouteProcedureApplyOptions<
  TMethods extends readonly RouteMethod[] | undefined = undefined,
> = {
  /**
   * Restricts this procedure run to the listed methods on this route.
   *
   * If omitted, the procedure runs for every method declared on the route.
   * Contributions from skipped procedures are typed as absent on `c.procedures`.
   */
  applyOnMethods?: TMethods;
};

type ProcedureAppliesToMethod<
  TApplied extends AnyAppliedRouteProcedure,
  TMethod extends RouteMethod,
> = TApplied extends { applyOnMethods?: infer TMethods }
  ? [TMethods] extends [readonly RouteMethod[]]
    ? TMethod extends TMethods[number]
      ? true
      : false
    : true
  : true;

type ExtractContributions<TApplied extends AnyAppliedRouteProcedure> =
  TApplied extends { procedure: infer TProcedure }
    ? TProcedure extends { _contributions?: infer TContributions }
      ? TContributions extends object
        ? TContributions
        : {}
      : {}
    : {};

/**
 * Intersection of contribution shapes from every applied procedure on the
 * route whose method filter includes the target method.
 */
export type InferAppliedProcedureContributions<
  TApplied extends readonly AnyAppliedRouteProcedure[],
  TMethod extends RouteMethod,
> = TApplied extends readonly [infer THead, ...infer TTail]
  ? THead extends AnyAppliedRouteProcedure
    ? TTail extends readonly AnyAppliedRouteProcedure[]
      ? (ProcedureAppliesToMethod<THead, TMethod> extends true
          ? ExtractContributions<THead>
          : {}) &
          InferAppliedProcedureContributions<TTail, TMethod>
      : {}
    : {}
  : {};

type ExtractParamsValue<TApplied extends AnyAppliedRouteProcedure> =
  TApplied extends { procedure: infer TProcedure }
    ? TProcedure extends { paramsSchema?: infer TSchema }
      ? TSchema extends z.ZodTypeAny
        ? z.infer<TSchema>
        : {}
      : {}
    : {};

type InferAppliedListParamsValue<
  TApplied extends readonly AnyAppliedRouteProcedure[],
> = TApplied extends readonly [infer THead, ...infer TTail]
  ? THead extends AnyAppliedRouteProcedure
    ? TTail extends readonly AnyAppliedRouteProcedure[]
      ? ExtractParamsValue<THead> & InferAppliedListParamsValue<TTail>
      : {}
    : {}
  : {};

/**
 * Intersection of every applied procedure's params with the route-level
 * params. Route params come LAST so they win on colliding keys.
 *
 * Note: params from procedures are merged unconditionally, regardless of
 * `applyOnMethods`, because path params live on the URL and must be present
 * for the route to be reachable at all.
 */
export type InferMergedParamsValue<
  TApplied extends readonly AnyAppliedRouteProcedure[],
  TRouteParamsSchema extends z.ZodTypeAny | undefined,
> = Simplify<
  InferAppliedListParamsValue<TApplied> &
    (TRouteParamsSchema extends z.ZodTypeAny ? z.infer<TRouteParamsSchema> : {})
>;
