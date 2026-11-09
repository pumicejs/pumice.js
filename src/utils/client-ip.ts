import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/**
 * Which `X-Forwarded-For` entries to believe.
 *
 * - `false` (the default): none. The client is the socket's peer address.
 * - a number `n`: `n` reverse proxies you run sit in front of the server. Each
 *   appends the address it saw, so the client is the `n`-th entry from the
 *   right; anything further left was written by the client and is ignored.
 * - `true`: every entry. The client is the leftmost one. Only safe when the
 *   proxy in front overwrites the header instead of appending to it.
 */
export type TrustProxy = boolean | number;

function socketAddress(context: Context): string | undefined {
  try {
    const address = getConnInfo(context).remote.address;
    return address && address.length > 0 ? address : undefined;
  } catch {
    // No Node bindings: the request came in through `server.fetch()` or
    // another runtime, so there is no socket to read.
    return undefined;
  }
}

function forwardedFor(context: Context): string[] {
  const header = context.req.header("x-forwarded-for");
  if (!header) {
    return [];
  }
  return header
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * The client's IP address, or `undefined` when it can't be known.
 *
 * Headers a client can set are never trusted unless `trustProxy` says a proxy
 * you run wrote them (see {@link TrustProxy}). Without a socket, as with
 * `server.fetch()` in tests, the address is `undefined`; callers decide what
 * that means (the rate limiter puts all such requests in one bucket).
 */
export function resolveClientIp(
  context: Context,
  trustProxy: TrustProxy = false,
): string | undefined {
  const peer = socketAddress(context);
  if (trustProxy === false || trustProxy === 0) {
    return peer;
  }

  const hops = forwardedFor(context);
  if (trustProxy === true) {
    return hops[0] ?? peer;
  }

  // The chain as the server sees it, nearest first: the socket's peer (the
  // last proxy), then each forwarded hop from the right.
  const chain = [peer, ...hops.reverse()];
  const trusted = Math.max(0, Math.floor(trustProxy));
  return chain[Math.min(trusted, chain.length - 1)] ?? peer;
}
