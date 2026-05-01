import type { Context } from "hono";
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
  userId?: (context: Context) => string | undefined | Promise<string | undefined>;
  /** Custom client-IP resolver. Defaults to header-based detection. */
  clientIp?: (context: Context) => string | undefined;
};

const DEFAULT_SCOPE: RatelimitScopePart[] = ["ip", "route"];

/** Reads a header in a header-name-case-insensitive manner. */
function readHeader(context: Context, name: string): string | undefined {
  return context.req.header(name) ?? undefined;
}

/**
 * Default IP detection: walks the common reverse-proxy headers, then
 * falls back to a placeholder. Override via {@link ScopeResolverOptions.clientIp}.
 */
export function defaultClientIp(context: Context): string {
  const forwardedFor = readHeader(context, "x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    readHeader(context, "x-real-ip") ??
    readHeader(context, "cf-connecting-ip") ??
    readHeader(context, "true-client-ip") ??
    "unknown"
  );
}

/**
 * Default user ID extractor: reads `c.auth?.data?.user?.id` if present.
 */
export function defaultUserId(context: Context): string | undefined {
  const auth = (context as unknown as { auth?: { data?: { user?: { id?: unknown } } } }).auth;
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
      const clientIp = options.clientIp ?? defaultClientIp;
      const value = clientIp(context);
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
