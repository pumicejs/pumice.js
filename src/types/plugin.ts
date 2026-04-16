import type { Context, Hono } from "hono";
import type { Server } from "../structures/server.js";

type UnionToIntersection<TValue> = (
  TValue extends unknown ? (arg: TValue) => void : never
) extends (arg: infer TIntersection) => void
  ? TIntersection
  : never;

export type AuthState<TData = unknown> = {
  authenticated: boolean;
  data?: TData;
};

export type Authenticator<TData = unknown> = (
  context: Context,
) => AuthState<TData> | Promise<AuthState<TData>>;

export type ContextRefinementRule<
  TWhen extends object = object,
  TPatch extends object = object,
> = {
  when: TWhen;
  patch: TPatch;
};

export type ApplyContextRefinementRules<
  TRules,
  TConfig extends object,
> = UnionToIntersection<
  TRules extends ContextRefinementRule<infer TWhen, infer TPatch>
    ? TConfig extends TWhen
      ? TPatch
      : {}
    : {}
>;

export type ServerPluginContext = {
  server: Server<object, object, never>;
  app: Hono;
};

export type ServerPlugin<
  TContext extends object = {},
  TRouteConfigExtensions extends object = {},
  TContextRefinementRules extends ContextRefinementRule = never,
> = {
  /**
   * For JSON endpoints registered here, use `createApiJsonSuccessResponse` and
   * `createApiJsonErrorResponse` from `pumice.js` so payloads match the framework
   * envelope (`code` / `message` / `data`, or the error shape).
   */
  apply(context: ServerPluginContext): void | Promise<void>;
  /**
   * Stable identifier set by the **plugin implementation** (not app config).
   * Required when `unique` is `true`.
   */
  id?: string;
  /**
   * When `true` on the plugin object, duplicate registrations with the same `id`
   * throw before `listen()` (or during `ServerBuilder.build()`). Only plugin authors
   * should set this; it is not part of user-facing plugin options.
   * @default false
   */
  unique?: boolean;
};
