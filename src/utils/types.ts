/**
 * Type-level helpers shared across the framework's builders and types.
 */

/** Flattens an intersection into one object type, for readable hovers. */
export type Simplify<T> = { [TKey in keyof T]: T[TKey] } & {};

/** `true` for object types that config merging recurses into. */
export type IsPlainObject<TValue> = TValue extends object
  ? TValue extends (...args: never[]) => unknown
    ? false
    : TValue extends readonly unknown[]
      ? false
      : true
  : false;

/**
 * The type of `mergeRouteConfig(base, override)`: plain objects merge key by
 * key, anything else in `TOverrideObject` replaces the base value.
 */
export type DeepMergeObjects<TBaseObject, TOverrideObject> = Simplify<
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
