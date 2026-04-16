type Simplify<T> = { [TKey in keyof T]: T[TKey] } & {};

/**
 * Per-route config consumed by runtime middleware/policies.
 *
 * Plugins can extend this shape through `ServerBuilder.use(...)`.
 */
export type RouteConfig<TExtensions extends object = {}> = Partial<Simplify<TExtensions>>;

/**
 * Server-wide defaults.
 */
export type ServerConfig<TExtensions extends object = {}> = {
  routes?: RouteConfig<TExtensions>;
};
