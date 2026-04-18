import type { Context } from "hono";
import { toJSONSchema, type z } from "zod";
import type {
  ExplicitRouteResponse,
  RouteThrowDescriptor,
  RouteThrowSchema,
  RouteThrowsCodeSchemaMap,
  RouteThrowsSchema,
  RouteResponseSchema,
  RouteParamsSchema,
  RouteSchema,
} from "../types/schema.js";
import type {
  AllowedFileType,
  FileConfig,
  FilesConfig,
  UploadedFile,
} from "../types/file.js";
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
    file?: UploadedFile;
    files?: UploadedFile[];
  };
};

const DEFAULT_FILE_FIELD_NAME = "file";
const DEFAULT_FILES_FIELD_NAME = "files";

type FileValidationIssue = {
  message: string;
  code: string;
  fieldName: string;
  file?: { name: string; type: string; size: number };
};

function isUploadedFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function matchesAllowedType(file: File, allowed: AllowedFileType): boolean {
  const normalizedAllowed = allowed.trim().toLowerCase();
  if (normalizedAllowed.length === 0) {
    return false;
  }

  if (normalizedAllowed.startsWith(".")) {
    return file.name.toLowerCase().endsWith(normalizedAllowed);
  }

  if (normalizedAllowed.endsWith("/*")) {
    const prefix = normalizedAllowed.slice(0, -1);
    return file.type.toLowerCase().startsWith(prefix);
  }

  return file.type.toLowerCase() === normalizedAllowed;
}

function validateSingleFileAgainstConfig(
  file: File,
  fieldName: string,
  config: Pick<FileConfig, "maxSize" | "minSize" | "allowedTypes">,
): FileValidationIssue | null {
  if (typeof config.maxSize === "number" && file.size > config.maxSize) {
    return {
      message: `File "${file.name}" exceeds max size of ${config.maxSize} bytes (got ${file.size}).`,
      code: "file_too_large",
      fieldName,
      file: { name: file.name, type: file.type, size: file.size },
    };
  }

  if (typeof config.minSize === "number" && file.size < config.minSize) {
    return {
      message: `File "${file.name}" is below min size of ${config.minSize} bytes (got ${file.size}).`,
      code: "file_too_small",
      fieldName,
      file: { name: file.name, type: file.type, size: file.size },
    };
  }

  if (config.allowedTypes && config.allowedTypes.length > 0) {
    const matched = config.allowedTypes.some((allowed) =>
      matchesAllowedType(file, allowed),
    );
    if (!matched) {
      return {
        message: `File "${file.name}" has disallowed type "${file.type}".`,
        code: "file_type_not_allowed",
        fieldName,
        file: { name: file.name, type: file.type, size: file.size },
      };
    }
  }

  return null;
}

type ValidationFailure = {
  ok: false;
  response: Response;
};

type RequestValidationResult = RequestValidationSuccess | ValidationFailure;
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

function hasBooleanJsonType(value: unknown): boolean {
  if (value === "boolean") {
    return true;
  }

  return (
    Array.isArray(value) && value.some((entry) => entry === "boolean")
  );
}

/**
 * Top-level object keys whose JSON Schema type is numeric — same idea as path
 * params: `multipart/form-data` and query values arrive as strings.
 */
function getNumericKeysFromObjectZodSchema(
  schema: z.ZodTypeAny | undefined,
): Set<string> {
  if (!schema) {
    return new Set<string>();
  }

  const jsonSchema = toJSONSchema(schema, { unrepresentable: "any" }) as {
    type?: unknown;
    properties?: Record<string, { type?: unknown }>;
  };

  if (jsonSchema.type !== "object" || !jsonSchema.properties) {
    return new Set<string>();
  }

  return new Set<string>(
    Object.entries(jsonSchema.properties)
      .filter(([, propertySchema]) => hasNumericJsonType(propertySchema.type))
      .map(([key]) => key),
  );
}

function getBooleanKeysFromObjectZodSchema(
  schema: z.ZodTypeAny | undefined,
): Set<string> {
  if (!schema) {
    return new Set<string>();
  }

  const jsonSchema = toJSONSchema(schema, { unrepresentable: "any" }) as {
    type?: unknown;
    properties?: Record<string, { type?: unknown }>;
  };

  if (jsonSchema.type !== "object" || !jsonSchema.properties) {
    return new Set<string>();
  }

  return new Set<string>(
    Object.entries(jsonSchema.properties)
      .filter(([, propertySchema]) => hasBooleanJsonType(propertySchema.type))
      .map(([key]) => key),
  );
}

function coerceScalarStringForFormData(
  value: string,
  kind: "number" | "boolean",
): unknown {
  if (kind === "number") {
    if (value.trim() === "") {
      return value;
    }
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }

  const t = value.trim().toLowerCase();
  if (t === "true" || t === "1") {
    return true;
  }
  if (t === "false" || t === "0") {
    return false;
  }
  return value;
}

function coerceFormDataFieldValue(
  value: unknown,
  kind: "number" | "boolean",
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === "string"
        ? coerceScalarStringForFormData(entry, kind)
        : entry,
    );
  }
  if (typeof value === "string") {
    return coerceScalarStringForFormData(value, kind);
  }
  return value;
}

function coerceMultipartFormBodyForZodSchema(
  body: Record<string, unknown>,
  bodySchema: z.ZodTypeAny,
): Record<string, unknown> {
  const numericKeys = getNumericKeysFromObjectZodSchema(bodySchema);
  const booleanKeys = getBooleanKeysFromObjectZodSchema(bodySchema);
  if (numericKeys.size === 0 && booleanKeys.size === 0) {
    return body;
  }

  const out: Record<string, unknown> = { ...body };
  for (const key of Object.keys(out)) {
    if (numericKeys.has(key)) {
      out[key] = coerceFormDataFieldValue(out[key], "number");
    } else if (booleanKeys.has(key)) {
      out[key] = coerceFormDataFieldValue(out[key], "boolean");
    }
  }
  return out;
}

function normalizeParams(
  context: Context,
  paramsSchema: RouteParamsSchema | undefined,
): Record<string, string | number> {
  const params = context.req.param();
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return {};
  }

  const numericParamKeys = getNumericKeysFromObjectZodSchema(paramsSchema);
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

type MultipartExtraction = {
  body: Record<string, unknown>;
  file?: File;
  files?: File[];
  issues: FileValidationIssue[];
};

async function extractMultipart(
  context: Context,
  fileConfig: FileConfig | undefined,
  filesConfig: FilesConfig | undefined,
): Promise<MultipartExtraction> {
  const issues: FileValidationIssue[] = [];
  let formData: FormData;

  try {
    formData = await context.req.formData();
  } catch (error) {
    throw new Error(
      `Malformed multipart/form-data body${
        error instanceof Error ? `: ${error.message}` : ""
      }`,
    );
  }

  const fileFieldName = fileConfig
    ? (fileConfig.fieldName ?? DEFAULT_FILE_FIELD_NAME)
    : undefined;
  const filesFieldName = filesConfig
    ? (filesConfig.fieldName ?? DEFAULT_FILES_FIELD_NAME)
    : undefined;

  let extractedFile: File | undefined;
  let extractedFiles: File[] | undefined;

  if (fileConfig && fileFieldName) {
    const entries = formData.getAll(fileFieldName);
    const fileEntries = entries.filter((entry): entry is File =>
      isUploadedFile(entry),
    );

    if (entries.length > 1 || fileEntries.length > 1) {
      issues.push({
        message: `Field "${fileFieldName}" expects a single file upload.`,
        code: "too_many_files",
        fieldName: fileFieldName,
      });
    } else if (fileEntries.length === 0) {
      if (fileConfig.required !== false) {
        issues.push({
          message: `Field "${fileFieldName}" is required.`,
          code: "file_missing",
          fieldName: fileFieldName,
        });
      }
    } else {
      const file = fileEntries[0]!;
      const issue = validateSingleFileAgainstConfig(
        file,
        fileFieldName,
        fileConfig,
      );
      if (issue) {
        issues.push(issue);
      } else {
        extractedFile = file;
      }
    }
  }

  if (filesConfig && filesFieldName) {
    const entries = formData.getAll(filesFieldName);
    const fileEntries = entries.filter((entry): entry is File =>
      isUploadedFile(entry),
    );

    const minCount = filesConfig.minCount ?? 0;
    if (fileEntries.length < minCount) {
      issues.push({
        message: `Field "${filesFieldName}" requires at least ${minCount} files (got ${fileEntries.length}).`,
        code: "too_few_files",
        fieldName: filesFieldName,
      });
    }

    if (
      typeof filesConfig.maxCount === "number" &&
      fileEntries.length > filesConfig.maxCount
    ) {
      issues.push({
        message: `Field "${filesFieldName}" accepts at most ${filesConfig.maxCount} files (got ${fileEntries.length}).`,
        code: "too_many_files",
        fieldName: filesFieldName,
      });
    }

    let totalSize = 0;
    const accepted: File[] = [];
    for (const file of fileEntries) {
      totalSize += file.size;
      const issue = validateSingleFileAgainstConfig(
        file,
        filesFieldName,
        filesConfig,
      );
      if (issue) {
        issues.push(issue);
        continue;
      }
      accepted.push(file);
    }

    if (
      typeof filesConfig.totalMaxSize === "number" &&
      totalSize > filesConfig.totalMaxSize
    ) {
      issues.push({
        message: `Field "${filesFieldName}" total size ${totalSize} bytes exceeds limit ${filesConfig.totalMaxSize}.`,
        code: "files_total_too_large",
        fieldName: filesFieldName,
      });
    }

    extractedFiles = accepted;
  }

  const body: Record<string, unknown> = {};
  const excludedFieldNames = new Set<string>();
  if (fileFieldName) excludedFieldNames.add(fileFieldName);
  if (filesFieldName) excludedFieldNames.add(filesFieldName);

  const groupedByName = new Map<string, FormDataEntryValue[]>();
  for (const [name, value] of formData.entries()) {
    if (excludedFieldNames.has(name)) {
      continue;
    }
    const bucket = groupedByName.get(name);
    if (bucket) {
      bucket.push(value);
    } else {
      groupedByName.set(name, [value]);
    }
  }

  for (const [name, values] of groupedByName) {
    const normalized = values.map((value) =>
      isUploadedFile(value) ? value : typeof value === "string" ? value : value,
    );
    body[name] = normalized.length > 1 ? normalized : normalized[0];
  }

  return { body, file: extractedFile, files: extractedFiles, issues };
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

async function validateThrownEntryPayload(
  throwSchema: RouteThrowSchema,
  error: NormalizedRouteError,
): Promise<ThrowValidationResult> {
  if (isZodSchema(throwSchema)) {
    const dataResult = await throwSchema.safeParseAsync(error.data);
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
    const dataResult = await dataSchema.safeParseAsync(error.data);
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
    const issuesResult = await issuesSchema.safeParseAsync(error.issues);
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
  let parsedFile: UploadedFile | undefined;
  let parsedFiles: UploadedFile[] | undefined;
  const validationErrors: Record<string, unknown> = {};

  const expectsMultipart = Boolean(schema?.file || schema?.files);

  if (expectsMultipart) {
    try {
      const extraction = await extractMultipart(
        context,
        schema?.file,
        schema?.files,
      );

      if (extraction.issues.length > 0) {
        validationErrors.files = extraction.issues;
      }

      parsedFile = extraction.file;
      parsedFiles = extraction.files;

      if (schema?.body) {
        const bodyForParse = coerceMultipartFormBodyForZodSchema(
          extraction.body,
          schema.body,
        );
        const bodyResult = await schema.body.safeParseAsync(bodyForParse);
        if (!bodyResult.success) {
          validationErrors.body = bodyResult.error.issues;
        } else {
          parsedBody = bodyResult.data;
        }
      } else {
        parsedBody = extraction.body;
      }
    } catch (error) {
      validationErrors.body = [
        {
          message: "Invalid multipart form body.",
          code: "invalid_body",
          reason:
            error instanceof Error ? error.message : "Unknown parsing error",
        },
      ];
    }
  } else if (schema?.body) {
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
      const bodyResult = await schema.body.safeParseAsync(parsedRequestBody);

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
    const queryResult = await schema.query.safeParseAsync(parsedQuery);

    if (!queryResult.success) {
      validationErrors.query = queryResult.error.issues;
    } else {
      parsedQuery = queryResult.data;
    }
  }

  if (schema?.headers) {
    const headersResult = await schema.headers.safeParseAsync(parsedHeaders);

    if (!headersResult.success) {
      validationErrors.headers = headersResult.error.issues;
    } else {
      parsedHeaders = headersResult.data;
    }
  }

  if (paramsSchema) {
    const paramsResult = await paramsSchema.safeParseAsync(parsedParams);

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
      file: parsedFile,
      files: parsedFiles,
    },
  };
}

export async function validateRouteThrownError(
  schema: RouteSchema | undefined,
  error: NormalizedRouteError,
): Promise<ThrowValidationResult> {
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
