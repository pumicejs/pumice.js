import type {
  ProcedureParamsSchema,
  RouteProcedureDefinition,
  RouteProcedureFactory,
  RouteProcedureHandler,
} from "../types/procedure.js";

/**
 * Fluent builder for a reusable route procedure.
 *
 * Stages:
 * - `.config<T>()` — type-only config accepted at use-site
 * - `.params(schema)` — merged with route params at registration
 * - `.handle(handler)` — finalizes and returns a callable factory
 */
export interface ProcedureBuilderStage<
  TConfig extends object = {},
  TParamsSchema extends ProcedureParamsSchema | undefined = undefined,
  TBaseContext extends object = {},
> {
  /**
   * Declares the config type this procedure accepts when applied to a route.
   * Type-only: validated by TypeScript, not at runtime.
   *
   * Example:
   * `server.procedure().config<{ skipOwnershipCheck?: boolean }>()`
   */
  config<TNextConfig extends object>(): ProcedureBuilderStage<
    TNextConfig,
    TParamsSchema,
    TBaseContext
  >;

  /**
   * Declares params this procedure expects on the route path.
   *
   * The schema is merged with the route's own params at registration; the
   * route's own `.params(...)` wins on colliding keys.
   */
  params<TNextParamsSchema extends ProcedureParamsSchema>(
    schema: TNextParamsSchema,
  ): ProcedureBuilderStage<TConfig, TNextParamsSchema, TBaseContext>;

  /**
   * Finalizes the procedure with a request-time handler.
   *
   * Returns a factory callable with (optional) config that yields the
   * procedure passed to `route().procedure(...)`.
   */
  handle<TContributions extends object | void | undefined>(
    handler: RouteProcedureHandler<
      TConfig,
      TParamsSchema,
      TContributions,
      TBaseContext
    >,
  ): RouteProcedureFactory<
    TConfig,
    TParamsSchema,
    Awaited<TContributions> extends object ? Awaited<TContributions> : {},
    TBaseContext
  >;
}

export class ProcedureBuilder<
  TConfig extends object = {},
  TParamsSchema extends ProcedureParamsSchema | undefined = undefined,
  TBaseContext extends object = {},
> implements ProcedureBuilderStage<TConfig, TParamsSchema, TBaseContext>
{
  private paramsSchema: ProcedureParamsSchema | undefined = undefined;

  public config<TNextConfig extends object>(): ProcedureBuilderStage<
    TNextConfig,
    TParamsSchema,
    TBaseContext
  > {
    return this as unknown as ProcedureBuilderStage<
      TNextConfig,
      TParamsSchema,
      TBaseContext
    >;
  }

  public params<TNextParamsSchema extends ProcedureParamsSchema>(
    schema: TNextParamsSchema,
  ): ProcedureBuilderStage<TConfig, TNextParamsSchema, TBaseContext> {
    this.paramsSchema = schema;
    return this as unknown as ProcedureBuilderStage<
      TConfig,
      TNextParamsSchema,
      TBaseContext
    >;
  }

  public handle<TContributions extends object | void | undefined>(
    handler: RouteProcedureHandler<
      TConfig,
      TParamsSchema,
      TContributions,
      TBaseContext
    >,
  ): RouteProcedureFactory<
    TConfig,
    TParamsSchema,
    Awaited<TContributions> extends object ? Awaited<TContributions> : {},
    TBaseContext
  > {
    const paramsSchema = this.paramsSchema as TParamsSchema | undefined;

    const factory = ((config?: TConfig) => {
      const definition: RouteProcedureDefinition<
        TConfig,
        TParamsSchema,
        Awaited<TContributions> extends object ? Awaited<TContributions> : {},
        TBaseContext
      > = {
        config: (config ?? ({} as TConfig)) as TConfig,
        paramsSchema,
        handler: handler as unknown as RouteProcedureHandler<
          TConfig,
          TParamsSchema,
          (Awaited<TContributions> extends object
            ? Awaited<TContributions>
            : {}) | void,
          TBaseContext
        >,
      };
      return definition;
    }) as RouteProcedureFactory<
      TConfig,
      TParamsSchema,
      Awaited<TContributions> extends object ? Awaited<TContributions> : {},
      TBaseContext
    >;

    return factory;
  }
}

export function createProcedureBuilder<
  TBaseContext extends object,
>(): ProcedureBuilderStage<{}, undefined, TBaseContext> {
  return new ProcedureBuilder<
    {},
    undefined,
    TBaseContext
  >() as unknown as ProcedureBuilderStage<{}, undefined, TBaseContext>;
}
