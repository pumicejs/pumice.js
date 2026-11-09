/**
 * Test helpers: call a fixture server in-process and read the JSON envelope.
 */

type FetchingServer = {
  fetch(request: Request, env?: unknown): Promise<Response>;
};

export type CallInit = Omit<RequestInit, "body"> & {
  /** Serialized as JSON with `content-type: application/json`. */
  json?: unknown;
  body?: BodyInit;
  /** Hono bindings; `socket(address)` builds the Node shape `getConnInfo` reads. */
  env?: unknown;
};

export type CallResult = {
  status: number;
  headers: Headers;
  /** Parsed JSON when the response is JSON, otherwise the text. */
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- tests read arbitrary envelope fields
};

/** Sends one request to `server` and returns its status, headers and parsed body. */
export async function call(
  server: FetchingServer,
  path: string,
  init: CallInit = {},
): Promise<CallResult> {
  const { json, env, headers, ...rest } = init;
  const requestHeaders = new Headers(headers);
  let body = rest.body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    if (!requestHeaders.has("content-type")) {
      requestHeaders.set("content-type", "application/json");
    }
  }
  const response = await server.fetch(
    new Request(`http://test.local${path}`, {
      ...rest,
      headers: requestHeaders,
      body,
    }),
    env,
  );
  const text = await response.text();
  const isJson = (response.headers.get("content-type") ?? "").includes("json");
  return {
    status: response.status,
    headers: response.headers,
    body: isJson && text.length > 0 ? JSON.parse(text) : text,
  };
}

/** Hono bindings as `@hono/node-server` passes them, carrying a socket address. */
export function socket(remoteAddress: string): unknown {
  return {
    incoming: {
      socket: {
        remoteAddress,
        remotePort: 50000,
        remoteFamily: remoteAddress.includes(":") ? "IPv6" : "IPv4",
      },
    },
  };
}
