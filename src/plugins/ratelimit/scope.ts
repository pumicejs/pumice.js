import type { Context } from "hono";
import { resolveClientIp } from "../../utils/client-ip.js";
import type {
  RatelimitRule,
  RatelimitScopeExpression,
  RatelimitScopePart,
} from "./types.js";

/**
 * Plugin-level options that affect how scope parts resolve.
 */
export type ScopeResolverOptions = {
  /**
   * Returns the user ID for a given request. Used by the `"user"`
   * scope part. Defaults to reading `c.auth?.data?.user?.id`.
   */
  userId?: (
    context: Context,
  ) => string | undefined | Promise<string | undefined>;
  /** Custom client-IP resolver. Defaults to the socket address ({@link resolveClientIp}). */
  clientIp?: (context: Context) => string | undefined;
};

const DEFAULT_SCOPE: RatelimitScopePart[] = ["ip", "route"];

/**
 * Default user ID extractor: reads `c.auth?.data?.user?.id` if present.
 */
export function defaultUserId(context: Context): string | undefined {
  const auth = (
    context as unknown as { auth?: { data?: { user?: { id?: unknown } } } }
  ).auth;
  const id = auth?.data?.user?.id;
  if (id === undefined || id === null) return undefined;
  return String(id);
}

async function resolveScopePart(
  context: Context,
  part: RatelimitScopePart,
  options: ScopeResolverOptions,
): Promise<string | undefined> {
  switch (part) {
    case "ip": {
      // A custom resolver replaces the default entirely: its `undefined`
      // means "unknown", not "fall back to the socket".
      const value = options.clientIp
        ? options.clientIp(context)
        : resolveClientIp(context);
      return value && value.length > 0 ? `ip:${value}` : undefined;
    }
    case "user": {
      const userIdFn = options.userId ?? defaultUserId;
      const value = await userIdFn(context);
      return value ? `user:${value}` : undefined;
    }
    case "route": {
      const routePath =
        (context.req as unknown as { routePath?: string }).routePath ??
        context.req.path;
      return `route:${routePath}`;
    }
    case "global":
      return "global";
  }
}

/**
 * Stable, sorted serialization of param values from `c.req.param()`.
 *
 * Hook stage: `c.params` (the validated bag) does not exist yet, but
 * Hono's raw param matcher does. That's fine — we only need stable
 * keys, not parsed types.
 */
function serializeParams(
  context: Context,
  respect: boolean | string[],
): string {
  if (respect === false) return "";
  const raw = context.req.param() as Record<string, string>;
  const keys = Object.keys(raw).sort();
  const filtered = Array.isArray(respect)
    ? keys.filter((key) => respect.includes(key))
    : keys;
  if (filtered.length === 0) return "";
  return filtered
    .map((key) => `${key}=${encodeURIComponent(raw[key] ?? "")}`)
    .join("&");
}

/**
 * Resolves a {@link RatelimitScopeExpression} against a request.
 *
 * Returns the bucket key (without the rule name suffix) — the caller
 * appends rule-specific qualifiers.
 */
export async function resolveScopeKey(
  context: Context,
  scope: RatelimitScopeExpression | undefined,
  options: ScopeResolverOptions,
): Promise<string> {
  if (typeof scope === "function") {
    return scope(context);
  }

  if (typeof scope === "object" && scope !== null && !Array.isArray(scope)) {
    const primary = await resolveScopePart(context, scope.by, options);
    if (primary !== undefined) return primary;
    if (scope.fallback) {
      const fallback = await resolveScopePart(context, scope.fallback, options);
      if (fallback !== undefined) return fallback;
    }
    return "anon";
  }

  const parts: RatelimitScopePart[] =
    scope === undefined
      ? DEFAULT_SCOPE
      : Array.isArray(scope)
        ? scope
        : [scope];

  const resolved: string[] = [];
  for (const part of parts) {
    const value = await resolveScopePart(context, part, options);
    resolved.push(value ?? "anon");
  }
  return resolved.join("|");
}

/**
 * Builds the final per-rule bucket key from scope + params + rule
 * disambiguator.
 */
export async function buildRuleKey(
  context: Context,
  rule: RatelimitRule,
  ruleIndex: number,
  options: ScopeResolverOptions,
): Promise<string> {
  const scopeKey = await resolveScopeKey(context, rule.scope, options);
  const respect = rule.respectParams ?? true;
  const paramsPart = serializeParams(context, respect);
  const ruleDisambiguator = rule.name ?? `#${ruleIndex}`;
  const algorithm = rule.algorithm ?? "fixed-window";
  return [scopeKey, paramsPart, `${algorithm}:${ruleDisambiguator}`]
    .filter((part) => part.length > 0)
    .join("|");
}
