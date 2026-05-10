import type {
  ProcedureParamsSchema,
  RouteProcedureDefinition,
  RouteProcedureFactory,
  RouteProcedureHandler,
} from "../types/procedure.js";
import type { ContextRefinementRule } from "../types/plugin.js";

/**
 * Fluent builder returned by `server.procedure()`.
 *
 * A procedure is a reusable per-request unit that:
 * - Optionally accepts use-site config (type-only).
 * - Optionally requires path params (merged with the route's own).
 * - Runs a handler after request validation and before the route handler.
 * - Contributes its return value to `c.procedures` for the route to consume.
 *
 * Chain order:
 *
 * ```text
 * server.procedure()
 *   ├── .config<TConfig>()        // type-only declaration of the config shape callers must pass
 *   ├── .params(zodObject)        // path-params schema merged with the route's params
 *   └── .handle(async (c) => ...) // returns a factory; call it to get a definition for `route().procedure(...)`
 * ```
 *
 * The factory returned by `.handle(...)` is what callers attach to a route:
 * `route().procedure(myProcedure(useSiteConfig))`.
 *
 * @typeParam TConfig Use-site config shape declared via `.config<T>()` (defaults to `{}`).
 * @typeParam TParamsSchema Path-params schema declared via `.params(...)`.
 * @typeParam TBaseContext Plugin-contributed context fields visible inside the handler.
 * @typeParam TContextRefinementRules Conditional context refinements applied based on default route config.
 * @typeParam TDefaultRouteConfig Server-wide default route config used to decide which refinements apply.
 *
 * @example
 * ```ts
 * // src/procedures/user.ts
 * export const userProcedure = server.procedure()
 *   .config<{ skipOwnershipCheck?: boolean }>()
 *   .params(z.object({ userId: z.coerce.number() }))
 *   .handle(async (c) => {
 *     const user = await repos.users.find(c.params.userId);
 *     if (!user) throw c.error({ status: 404 });
 *     if (!c.config.skipOwnershipCheck && user.id !== c.auth.data.user.id) {
 *       throw c.error({ status: 403 });
 *     }
 *     return { user };
 *   });
 *
 * // src/routes/users/[userId]/route.ts
 * server.route()
 *   .procedure(userProcedure())
 *   .get().handle((c) => ({ user: c.procedures.user }));
 * ```
 */
export interface ProcedureBuilderStage<
  TConfig extends object = {},
  TParamsSchema extends ProcedureParamsSchema | undefined = undefined,
  TBaseContext extends object = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultRouteConfig extends object = {},
> {
  /**
   * Declares the config shape this procedure accepts at use-site.
   *
   * Type-only — there is no runtime validation. The factory returned by
   * `.handle(...)` becomes mandatory-arg if `TNextConfig` has any required
   * keys, and optional-arg otherwise.
   *
   * Inside the handler, the resolved config is available on `c.config`.
   *
   * @example
   * ```ts
   * server.procedure()
   *   .config<{ skipOwnershipCheck?: boolean; minRole?: "staff" | "admin" }>()
   *   .handle((c) => { c.config.minRole; });
   *
   * // use-site:
   * .procedure(myProcedure({ skipOwnershipCheck: true }))
   * ```
   */
  config<TNextConfig extends object>(): ProcedureBuilderStage<
    TNextConfig,
    TParamsSchema,
    TBaseContext,
    TContextRefinementRules,
    TDefaultRouteConfig
  >;

  /**
   * Declares path params this procedure expects.
   *
   * The schema is merged with the route's own params at registration. Mixed
   * sources must all be `z.object(...)`. The route's own `.params(...)` wins
   * on colliding keys.
   *
   * Inside the handler, the validated params are available on `c.params`.
   *
   * @example
   * ```ts
   * server.procedure()
   *   .params(z.object({ userId: z.coerce.number() }))
   *   .handle((c) => repos.users.find(c.params.userId));
   * ```
   */
  params<TNextParamsSchema extends ProcedureParamsSchema>(
    schema: TNextParamsSchema,
  ): ProcedureBuilderStage<
    TConfig,
    TNextParamsSchema,
    TBaseContext,
    TContextRefinementRules,
    TDefaultRouteConfig
  >;

  /**
   * Finalizes the procedure with a request-time handler and returns a factory.
   *
   * Handler context (`c`):
   * - `c.params` — validated procedure params.
   * - `c.config` — use-site config supplied to the factory.
   * - Plugin-contributed fields (e.g. `c.auth`) and any default-config
   *   refinements (e.g. `c.auth.data` non-optional when `authentication.required`
   *   is the default).
   * - `c.error({...})` — typed `ApiError` factory; throw to surface 4xx errors.
   *
   * Handler return value:
   * - Returning a non-empty object **contributes those keys** to `c.procedures`
   *   on every route that attaches this procedure (typed precisely from the
   *   inferred return type).
   * - Returning `void` / `undefined` contributes nothing.
   *
   * The returned factory is callable as `myProcedure(config)` (or just
   * `myProcedure()` if `TConfig` has no required keys) and yields the value
   * passed to `route().procedure(...)`.
   *
   * @example
   * ```ts
   * const userProcedure = server.procedure()
   *   .config<{ skipOwnershipCheck?: boolean }>()
   *   .params(z.object({ userId: z.coerce.number() }))
   *   .handle(async (c) => {
   *     const user = await repos.users.find(c.params.userId);
   *     if (!user) throw c.error({ status: 404 });
   *     return { user }; // c.procedures.user typed as User
   *   });
   *
   * // attach to a route:
   * server.route()
   *   .procedure(userProcedure({ skipOwnershipCheck: true }))
   *   .get().handle((c) => c.procedures.user);
   * ```
   */
  handle<TContributions extends object | void | undefined>(
    handler: RouteProcedureHandler<
      TConfig,
      TParamsSchema,
      TContributions,
      TBaseContext,
      TContextRefinementRules,
      TDefaultRouteConfig
    >,
  ): RouteProcedureFactory<
    TConfig,
    TParamsSchema,
    Awaited<TContributions> extends object ? Awaited<TContributions> : {},
    TBaseContext,
    TContextRefinementRules,
    TDefaultRouteConfig
  >;
}

/**
 * Concrete implementation of {@link ProcedureBuilderStage}.
 *
 * Most callers should not instantiate this directly — use `server.procedure()`
 * (which returns the typed builder interface) and let TypeScript drive the
 * chain.
 */
export class ProcedureBuilder<
  TConfig extends object = {},
  TParamsSchema extends ProcedureParamsSchema | undefined = undefined,
  TBaseContext extends object = {},
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultRouteConfig extends object = {},
> implements
    ProcedureBuilderStage<
      TConfig,
      TParamsSchema,
      TBaseContext,
      TContextRefinementRules,
      TDefaultRouteConfig
    >
{
  private paramsSchema: ProcedureParamsSchema | undefined = undefined;

  public config<TNextConfig extends object>(): ProcedureBuilderStage<
    TNextConfig,
    TParamsSchema,
    TBaseContext,
    TContextRefinementRules,
    TDefaultRouteConfig
  > {
    return this as unknown as ProcedureBuilderStage<
      TNextConfig,
      TParamsSchema,
      TBaseContext,
      TContextRefinementRules,
      TDefaultRouteConfig
    >;
  }

  public params<TNextParamsSchema extends ProcedureParamsSchema>(
    schema: TNextParamsSchema,
  ): ProcedureBuilderStage<
    TConfig,
    TNextParamsSchema,
    TBaseContext,
    TContextRefinementRules,
    TDefaultRouteConfig
  > {
    this.paramsSchema = schema;
    return this as unknown as ProcedureBuilderStage<
      TConfig,
      TNextParamsSchema,
      TBaseContext,
      TContextRefinementRules,
      TDefaultRouteConfig
    >;
  }

  public handle<TContributions extends object | void | undefined>(
    handler: RouteProcedureHandler<
      TConfig,
      TParamsSchema,
      TContributions,
      TBaseContext,
      TContextRefinementRules,
      TDefaultRouteConfig
    >,
  ): RouteProcedureFactory<
    TConfig,
    TParamsSchema,
    Awaited<TContributions> extends object ? Awaited<TContributions> : {},
    TBaseContext,
    TContextRefinementRules,
    TDefaultRouteConfig
  > {
    const paramsSchema = this.paramsSchema as TParamsSchema | undefined;

    const factory = ((config?: TConfig) => {
      const definition: RouteProcedureDefinition<
        TConfig,
        TParamsSchema,
        Awaited<TContributions> extends object ? Awaited<TContributions> : {},
        TBaseContext,
        TContextRefinementRules,
        TDefaultRouteConfig
      > = {
        config: (config ?? ({} as TConfig)) as TConfig,
        paramsSchema,
        handler: handler as unknown as RouteProcedureHandler<
          TConfig,
          TParamsSchema,
          (Awaited<TContributions> extends object
            ? Awaited<TContributions>
            : {}) | void,
          TBaseContext,
          TContextRefinementRules,
          TDefaultRouteConfig
        >,
      };
      return definition;
    }) as RouteProcedureFactory<
      TConfig,
      TParamsSchema,
      Awaited<TContributions> extends object ? Awaited<TContributions> : {},
      TBaseContext,
      TContextRefinementRules,
      TDefaultRouteConfig
    >;

    return factory;
  }
}

/**
 * Creates a fresh procedure builder.
 *
 * Internal-ish — `server.procedure()` calls this with the server's typed
 * context extensions / refinement rules so the builder's handler context
 * matches the server's contract.
 */
export function createProcedureBuilder<
  TBaseContext extends object,
  TContextRefinementRules extends ContextRefinementRule = never,
  TDefaultRouteConfig extends object = {},
>(): ProcedureBuilderStage<
  {},
  undefined,
  TBaseContext,
  TContextRefinementRules,
  TDefaultRouteConfig
> {
  return new ProcedureBuilder<
    {},
    undefined,
    TBaseContext,
    TContextRefinementRules,
    TDefaultRouteConfig
  >() as unknown as ProcedureBuilderStage<
    {},
    undefined,
    TBaseContext,
    TContextRefinementRules,
    TDefaultRouteConfig
  >;
}
