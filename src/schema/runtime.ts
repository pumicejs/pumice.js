import type { Context } from "hono";
import { toJSONSchema, type z } from "zod";
import type {
  ExplicitRouteResponse,
  RouteThrowDescriptor,
  RouteThrowSchema,
  RouteThrowsCodeSchemaMap,
  RouteThrowsSchema,
  RouteResponseSchema,
  RouteResponseSchemaMap,
  RouteParamsSchema,
  RouteSchema,
} from "../types/schema.js";
import {
  ApiError,
  getStatusMessage,
  type ApiErrorIssue,
  type ApiErrorInit,
} from "../errors/api.js";
import {
  buildApiJsonSuccessBody,
  createApiJsonErrorResponse,
} from "../http/json-envelope.js";

type RequestValidationSuccess = {
  ok: true;
  data: {
    body: unknown;
    query: unknown;
    headers: unknown;
    params: unknown;
  };
};

type ValidationFailure = {
  ok: false;
  response: Response;
};

type RequestValidationResult = RequestValidationSuccess | ValidationFailure;
type ResponseValidationResult = { ok: true } | ValidationFailure;
type ThrowValidationResult = { ok: true } | ValidationFailure;

type NormalizedRouteError = {
  status: number;
  code?: string;
  message: string;
  data?: unknown;
  issues?: unknown;
  headers?: Record<string, string>;
};

function normalizeValidationDetails(details: unknown): {
  data?: unknown;
  issues?: unknown;
} {
  if (Array.isArray(details)) {
    return { issues: details };
  }

  return { data: details };
}

export function createValidationErrorResponse(
  status: number,
  message: string,
  details: unknown,
): Response {
  const normalized = normalizeValidationDetails(details);
  return createApiJsonErrorResponse(status, {
    code: "VALIDATION_ERROR",
    message,
    data: normalized.data,
    issues: normalized.issues,
  });
}

function normalizeQuery(url: string): Record<string, string> {
  const searchParams = new URL(url).searchParams;
  return Object.fromEntries(searchParams.entries());
}

function normalizeHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function hasNumericJsonType(value: unknown): boolean {
  if (value === "number" || value === "integer") {
    return true;
  }

  return (
    Array.isArray(value) &&
    value.some((entry) => entry === "number" || entry === "integer")
  );
}

function getNumericParamKeys(paramsSchema: RouteParamsSchema | undefined): Set<string> {
  if (!paramsSchema) {
    return new Set<string>();
  }

  const jsonSchema = toJSONSchema(paramsSchema, { unrepresentable: "any" }) as {
    type?: unknown;
    properties?: Record<string, { type?: unknown }>;
  };

  if (jsonSchema.type !== "object" || !jsonSchema.properties) {
    return new Set<string>();
  }

  return new Set<string>(
    Object.entries(jsonSchema.properties)
      .filter(([, schema]) => hasNumericJsonType(schema.type))
      .map(([key]) => key),
  );
}

function normalizeParams(
  context: Context,
  paramsSchema: RouteParamsSchema | undefined,
): Record<string, string | number> {
  const params = context.req.param();
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return {};
  }

  const numericParamKeys = getNumericParamKeys(paramsSchema);
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => {
      const normalizedValue = String(value);
      if (numericParamKeys.has(key)) {
        return [key, Number(normalizedValue)];
      }
      return [key, normalizedValue];
    }),
  );
}

async function readRequestBody(
  context: Context,
  options: { expectJson: boolean },
): Promise<{ parsed: unknown; raw: string }> {
  const rawBody = await context.req.text();

  if (!options.expectJson) {
    return {
      parsed: rawBody,
      raw: rawBody,
    };
  }

  // Schema-backed request bodies are treated as JSON payloads by default.
  try {
    return {
      parsed: JSON.parse(rawBody),
      raw: rawBody,
    };
  } catch (error) {
    throw new Error(
      `Malformed JSON body${
        error instanceof Error ? `: ${error.message}` : ""
      }`,
    );
  }
}

function isResponseStatusMap(
  responseSchema: RouteResponseSchema,
): responseSchema is RouteResponseSchemaMap {
  return !("safeParse" in responseSchema);
}

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return typeof value === "object" && value !== null && "safeParse" in value;
}

function isThrowDescriptor(value: unknown): value is RouteThrowDescriptor {
  return (
    typeof value === "object" &&
    value !== null &&
    !isZodSchema(value) &&
    ("data" in value || "issues" in value || "message" in value)
  );
}

function isThrowsCodeSchemaMap(throwsSchema: unknown): throwsSchema is RouteThrowsCodeSchemaMap {
  return (
    typeof throwsSchema === "object" &&
    throwsSchema !== null &&
    !isZodSchema(throwsSchema) &&
    !isThrowDescriptor(throwsSchema)
  );
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status <= 299;
}

function isClientErrorStatus(status: number): boolean {
  return status >= 400 && status <= 499;
}

export function createExplicitRouteResponse<
  TResponse extends RouteResponseSchema | undefined,
>(response: {
  status: number;
  data: unknown;
  code?: string;
  message?: string;
  issues?: ApiErrorIssue[];
  headers?: Record<string, string>;
}): ExplicitRouteResponse<TResponse> {
  return {
    _kind: "explicit_route_response",
    status: response.status,
    data: response.data,
    code: response.code,
    message: response.message,
    issues: response.issues,
    headers: response.headers,
  };
}

export function isExplicitRouteResponse(
  value: unknown,
): value is ExplicitRouteResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "_kind" in value &&
    value._kind === "explicit_route_response"
  );
}

export function createApiError(status: number): ApiError;
export function createApiError(init: ApiErrorInit): ApiError;
export function createApiError(
  status: number,
  init: Omit<ApiErrorInit, "status">,
): ApiError;
export function createApiError(
  valueOrStatus: number | ApiErrorInit,
  init?: Omit<ApiErrorInit, "status">,
): ApiError {
  if (typeof valueOrStatus === "number") {
    if (init) {
      return new ApiError({
        status: valueOrStatus,
        ...init,
      });
    }

    return new ApiError(valueOrStatus);
  }

  return new ApiError(valueOrStatus);
}

function normalizeApiError(error: unknown): NormalizedRouteError {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      data: error.data,
      issues: error.issues.length > 0 ? error.issues : undefined,
      headers: error.headers,
    };
  }

  if (typeof error === "number") {
    if (isClientErrorStatus(error)) {
      return {
        status: error,
        message: getStatusMessage(error),
      };
    }

    return {
      status: 500,
      message: `Only 4xx numeric throws are allowed. Received: ${error}.`,
      code: "INVALID_THROW_STATUS",
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      message: error.message,
      code: "INTERNAL_ERROR",
    };
  }

  return {
    status: 500,
    message: "Unhandled route error.",
    code: "INTERNAL_ERROR",
    data: error,
  };
}

function createApiErrorResponse(error: NormalizedRouteError): Response {
  return createApiJsonErrorResponse(
    error.status,
    {
      code: error.code ?? "API_ERROR",
      message: error.message,
      data: error.data,
      issues: error.issues,
    },
    error.headers,
  );
}

function validateThrownEntryPayload(
  throwSchema: RouteThrowSchema,
  error: NormalizedRouteError,
): ThrowValidationResult {
  if (isZodSchema(throwSchema)) {
    const dataResult = throwSchema.safeParse(error.data);
    if (!dataResult.success) {
      return {
        ok: false,
        response: createValidationErrorResponse(
          500,
          "Thrown error payload validation failed.",
          dataResult.error.issues,
        ),
      };
    }

    return { ok: true };
  }

  const dataSchema = throwSchema.data;
  if (dataSchema) {
    const dataResult = dataSchema.safeParse(error.data);
    if (!dataResult.success) {
      return {
        ok: false,
        response: createValidationErrorResponse(
          500,
          "Thrown error payload validation failed.",
          dataResult.error.issues,
        ),
      };
    }
  } else if (error.data !== undefined) {
    return {
      ok: false,
      response: createValidationErrorResponse(
        500,
        "Thrown error payload validation failed.",
        "No throw data schema is configured for this error, but data was provided.",
      ),
    };
  }

  const issuesSchema = throwSchema.issues;
  if (issuesSchema) {
    const issuesResult = issuesSchema.safeParse(error.issues);
    if (!issuesResult.success) {
      return {
        ok: false,
        response: createValidationErrorResponse(
          500,
          "Thrown error issues validation failed.",
          issuesResult.error.issues,
        ),
      };
    }
  }

  return { ok: true };
}

function createExplicitResponseBody(response: ExplicitRouteResponse): unknown {
  return buildApiJsonSuccessBody(
    response.data,
    response.status,
    response.code,
    response.message,
    response.issues,
  );
}

export async function validateRouteRequest(
  context: Context,
  schema: RouteSchema | undefined,
  paramsSchema: RouteParamsSchema | undefined,
): Promise<RequestValidationResult> {
  let parsedBody: unknown = undefined;
  let parsedQuery: unknown = normalizeQuery(context.req.url);
  let parsedHeaders: unknown = normalizeHeaders(context.req.raw.headers);
  let parsedParams: unknown = normalizeParams(context, paramsSchema);
  const validationErrors: Record<string, unknown> = {};

  if (schema?.body) {
    let parsedRequestBody: unknown;
    let rawRequestBody = "";

    try {
      const requestBody = await readRequestBody(context, { expectJson: true });
      parsedRequestBody = requestBody.parsed;
      rawRequestBody = requestBody.raw;
    } catch (error) {
      validationErrors.body = [
        {
          message: "Invalid request body.",
          code: "invalid_body",
          reason:
            error instanceof Error ? error.message : "Unknown parsing error",
        },
      ];
    }

    if (!validationErrors.body) {
      const bodyResult = schema.body.safeParse(parsedRequestBody);

      if (!bodyResult.success) {
        const firstIssue = bodyResult.error.issues.at(0);
        const looksLikeObjectJsonText =
          typeof parsedRequestBody === "string" &&
          (rawRequestBody.trim().startsWith("\"{") ||
            rawRequestBody.trim().startsWith("\"["));

        if (
          looksLikeObjectJsonText &&
          firstIssue?.code === "invalid_type" &&
          firstIssue.expected === "object"
        ) {
          validationErrors.body = [
            {
              message:
                "Request body appears to be a JSON string instead of a JSON object.",
              code: "invalid_body",
              reason:
                "Remove wrapping quotes around the JSON body (double-encoded JSON).",
            },
          ];
        } else {
          validationErrors.body = bodyResult.error.issues;
        }
      } else {
        parsedBody = bodyResult.data;
      }
    }
  }

  if (schema?.query) {
    const queryResult = schema.query.safeParse(parsedQuery);

    if (!queryResult.success) {
      validationErrors.query = queryResult.error.issues;
    } else {
      parsedQuery = queryResult.data;
    }
  }

  if (schema?.headers) {
    const headersResult = schema.headers.safeParse(parsedHeaders);

    if (!headersResult.success) {
      validationErrors.headers = headersResult.error.issues;
    } else {
      parsedHeaders = headersResult.data;
    }
  }

  if (paramsSchema) {
    const paramsResult = paramsSchema.safeParse(parsedParams);

    if (!paramsResult.success) {
      validationErrors.params = paramsResult.error.issues;
    } else {
      parsedParams = paramsResult.data;
    }
  }

  if (Object.keys(validationErrors).length > 0) {
    return {
      ok: false,
      response: createValidationErrorResponse(
        400,
        "Request validation failed.",
        validationErrors,
      ),
    };
  }

  return {
    ok: true,
    data: {
      body: parsedBody,
      query: parsedQuery,
      headers: parsedHeaders,
      params: parsedParams,
    },
  };
}

export function validateRouteResponsePayload(
  schema: RouteSchema | undefined,
  payload: unknown,
  status: number,
  options: { strictStatus: boolean } = { strictStatus: true },
): ResponseValidationResult {
  const responseSchema = schema?.response;

  if (!responseSchema) {
    return { ok: true };
  }

  if (isResponseStatusMap(responseSchema)) {
    if (!isSuccessfulStatus(status)) {
      return {
        ok: false,
        response: createValidationErrorResponse(
          500,
          "Response status validation failed.",
          {
            status,
            reason: "Only 2xx response statuses are allowed.",
          },
        ),
      };
    }

    const allowedStatuses = Object.keys(responseSchema).map((value) =>
      Number(value),
    );
    const statusSchema = responseSchema[status];

    if (!options.strictStatus) {
      const matchingSchema = Object.values(responseSchema).find((statusMapSchema) =>
        statusMapSchema.safeParse(payload).success,
      );

      if (matchingSchema) {
        return { ok: true };
      }

      return {
        ok: false,
        response: createValidationErrorResponse(
          500,
          "Response body validation failed.",
          {
            status,
            allowedStatuses,
            reason:
              "Implicit return values must match at least one declared 2xx response schema.",
          },
        ),
      };
    }

    if (!statusSchema) {
      return {
        ok: false,
        response: createValidationErrorResponse(
          500,
          "Response status validation failed.",
          {
            status,
            allowedStatuses,
          },
        ),
      };
    }

    const statusResult = statusSchema.safeParse(payload);

    if (!statusResult.success) {
      return {
        ok: false,
        response: createValidationErrorResponse(
          500,
          `Response body validation failed for status ${status}.`,
          statusResult.error.issues,
        ),
      };
    }

    return { ok: true };
  }

  const responseResult = responseSchema.safeParse(payload);

  if (!responseResult.success) {
    return {
      ok: false,
      response: createValidationErrorResponse(
        500,
        "Response body validation failed.",
        responseResult.error.issues,
      ),
    };
  }

  return { ok: true };
}

export function validateRouteThrownError(
  schema: RouteSchema | undefined,
  error: NormalizedRouteError,
): ThrowValidationResult {
  if (!isClientErrorStatus(error.status)) {
    return {
      ok: false,
      response: createValidationErrorResponse(
        500,
        "Throw status validation failed.",
        {
          status: error.status,
          reason: "Thrown route errors must use 4xx status codes.",
        },
      ),
    };
  }

  const throwsSchema = schema?.throws;
  if (!throwsSchema) {
    return { ok: true };
  }

  const statusSchema = throwsSchema[error.status];
  if (!statusSchema) {
    return {
      ok: false,
      response: createValidationErrorResponse(
        500,
        "Throw status validation failed.",
        {
          status: error.status,
          allowedStatuses: Object.keys(throwsSchema).map((value) => Number(value)),
        },
      ),
    };
  }

  if (isThrowsCodeSchemaMap(statusSchema)) {
    if (!error.code) {
      return {
        ok: false,
        response: createValidationErrorResponse(
          500,
          "Throw code validation failed.",
          {
            status: error.status,
            reason:
              "A code is required for this status because throws schema is code-mapped.",
            allowedCodes: Object.keys(statusSchema),
          },
        ),
      };
    }

    const codeSchema = (statusSchema as RouteThrowsCodeSchemaMap)[error.code];
    if (!codeSchema) {
      return {
        ok: false,
        response: createValidationErrorResponse(
          500,
          "Throw code validation failed.",
          {
            status: error.status,
            code: error.code,
            allowedCodes: Object.keys(statusSchema),
          },
        ),
      };
    }

    return validateThrownEntryPayload(codeSchema, error);
  }

  return validateThrownEntryPayload(statusSchema, error);
}

export function normalizeHandlerSuccessResult(
  result: unknown,
): {
  payload: unknown;
  responseBody: unknown;
  status: number;
  headers?: Record<string, string>;
} {
  if (isExplicitRouteResponse(result)) {
    return {
      payload: result.data,
      responseBody: createExplicitResponseBody(result),
      status: result.status,
      headers: result.headers,
    };
  }

  return {
    payload: result,
    responseBody: buildApiJsonSuccessBody(result, 200),
    status: 200,
  };
}

export function normalizeHandlerThrownError(error: unknown): NormalizedRouteError {
  return normalizeApiError(error);
}

export function buildApiErrorResponse(error: NormalizedRouteError): Response {
  return createApiErrorResponse(error);
}
