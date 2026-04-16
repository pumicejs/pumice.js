import type { RouteConfig } from "../types/config.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function mergeDefined(
  baseValue: unknown,
  overrideValue: unknown,
): unknown {
  if (overrideValue === undefined) {
    return baseValue;
  }

  if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
    const merged: Record<string, unknown> = { ...baseValue };

    for (const [key, value] of Object.entries(overrideValue)) {
      merged[key] = mergeDefined(baseValue[key], value);
    }

    return merged;
  }

  return overrideValue;
}

/**
 * Merges route config objects by precedence:
 * method-level > route-level > server defaults.
 *
 * `undefined` values in overrides keep inherited values from lower precedence.
 */
export function mergeRouteConfig<TExtensions extends object>(
  baseConfig: RouteConfig<TExtensions> | undefined,
  overrideConfig: RouteConfig<TExtensions> | undefined,
): RouteConfig<TExtensions> {
  return mergeDefined(baseConfig ?? {}, overrideConfig ?? {}) as RouteConfig<TExtensions>;
}
