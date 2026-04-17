import type { Context } from "hono";
import type { z } from "zod";
import type { ApiError, ApiErrorIssue } from "../errors/api.js";
import type { FileConfig, FilesConfig, UploadedFile } from "./file.js";

export type Simplify<T> = { [TKey in keyof T]: T[TKey] } & {};

export type AnyRouteSchema = z.ZodTypeAny;
export type RouteParamsSchema = z.ZodTypeAny;
type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type NumberFromString<TValue extends string> =
  TValue extends `${infer TValueAsNumber extends number}` ? TValueAsNumber : never;
type SuccessStatusString = `2${Digit}${Digit}`;
type ErrorStatusString = `4${Digit}${Digit}`;
export type SuccessStatusCode = NumberFromString<SuccessStatusString>;
export type ErrorStatusCode = NumberFromString<ErrorStatusString>;

/**
 * Map of success status code -> response payload schema.
 *
 * Example:
 * `{ 200: UserSchema, 201: CreatedUserSchema }`
 */
export type RouteResponseSchemaMap = Record<number, z.ZodTypeAny>;
/**
 * Allowed response declaration shapes:
 * - a single schema used for all 2xx responses
 * - a map of explicit 2xx statuses to schemas
 */
export type RouteResponseSchema = z.ZodTypeAny | RouteResponseSchemaMap;
/**
 * Fine-grained thrown error schema declaration for one status/code.
 *
 * - `data`: structured error payload
 * - `issues`: list (or object) of sub-errors/validation issues
 */
export type RouteThrowDescriptor = {
  /**
   * Error payload schema for this throw entry.
   *
   * Example:
   * `data: z.object({ name: z.string() })`
   */
  data?: z.ZodTypeAny;
  /**
   * Optional schema for issue/sub-error structures attached via `error.issues`.
   *
   * When omitted, issues default to `ApiErrorIssue[]`.
   */
  issues?: z.ZodTypeAny;
  /**
   * Optional default error message for this throw entry.
   *
   * Used only when `context.error(...)` does not provide an explicit message.
   */
  message?: string;
};
/**
 * A thrown error entry can be a single payload schema or a descriptor with
 * separate `data` and `issues` schemas.
 */
export type RouteThrowSchema = z.ZodTypeAny | RouteThrowDescriptor;
/**
 * Optional second-level throws map keyed by semantic error code.
 *
 * Example:
 * `{ INVALID_EMAIL: { data: ValidationData, issues: z.array(IssueSchema) } }`
 */
export type RouteThrowsCodeSchemaMap = Record<string, RouteThrowSchema>;
/**
 * Main throws map keyed by 4xx HTTP status.
 *
 * Example:
 * `{
 *   404: { data: NotFoundData, issues: z.array(IssueSchema) },
 *   400: {
 *     INVALID_BODY: { data: ValidationData, issues: z.array(IssueSchema) }
 *   }
 * }`
 */
export type RouteThrowsSchemaMap = Record<
  number,
  RouteThrowSchema | RouteThrowsCodeSchemaMap
>;
export type RouteThrowsSchema = RouteThrowsSchemaMap;

type HasNon2xxKeys<TSchemaMap extends RouteResponseSchemaMap> = Exclude<
  keyof TSchemaMap & number,
  SuccessStatusCode
> extends never
  ? false
  : true;

type HasNon4xxKeys<TSchemaMap extends RouteThrowsSchemaMap> = Exclude<
  keyof TSchemaMap & number,
  ErrorStatusCode
> extends never
  ? false
  : true;

type Ensure2xxMap<TSchema extends RouteResponseSchema> =
  TSchema extends z.ZodTypeAny
    ? TSchema
    : TSchema extends RouteResponseSchemaMap
      ? HasNon2xxKeys<TSchema> extends true
        ? never
        : TSchema
      : never;

type Ensure4xxMap<TSchema extends RouteThrowsSchemaMap> =
  HasNon4xxKeys<TSchema> extends true ? never : TSchema;

export type RouteResponseSchemaInput<TSchema extends RouteResponseSchema> =
  Ensure2xxMap<TSchema>;
export type RouteThrowsSchemaInput<TSchema extends RouteThrowsSchemaMap> =
  Ensure4xxMap<TSchema>;

/**
 * Route-level schema contract used by `server.route().schema(...)`.
 *
 * Notes:
 * - `response` only accepts 2xx statuses
 * - `throws` only accepts 4xx statuses
 * - `throws` entries can define `issues` for sub-errors
 */
export type RouteSchema = {
  /**
   * Request body schema.
   *
   * Notes:
   * - Intended for non-GET routes.
   * - GET routes are blocked from declaring body schemas by the route builder.
   */
  body?: z.ZodTypeAny;
  /**
   * Query string schema.
   *
   * Example:
   * `query: z.object({ name: z.string(), page: z.coerce.number().default(1) })`
   */
  query?: z.ZodTypeAny;
  /**
   * Request headers schema.
   *
   * Example:
   * `headers: z.object({ authorization: z.string() })`
   */
  headers?: z.ZodTypeAny;
  /**
   * Success response schema declaration.
   *
   * Allowed shapes:
   * - Single schema: `response: z.object({...})`
   * - 2xx status map: `response: { 200: A, 201: B }`
   */
  response?: RouteResponseSchema;
  /**
   * Declares typed throwable error contracts (4xx only).
   *
   * Allowed shapes per status:
   * - Direct schema: `404: z.object({...})`
   * - Descriptor: `404: { data: z.object({...}), issues: z.array(...), message: "..." }`
   * - Code map: `422: { INVALID_NAME: { data: ..., message: "..." } }`
   *
   * Runtime behavior:
   * - Status must be 4xx
   * - Code is required when the status uses a code map
   * - Descriptor/code-map `message` is used as fallback only when no message is passed to `context.error(...)`
   */
  throws?: RouteThrowsSchema;
  /**
   * Single-file upload contract declared by `.file(...)`.
   *
   * When present, the request body is parsed as `multipart/form-data` and the
   * file at `config.fieldName` (default `"file"`) is surfaced at `c.file`.
   * Any remaining form fields are validated against the `body` schema.
   */
  file?: FileConfig;
  /**
   * Multi-file upload contract declared by `.files(...)`.
   *
   * When present, the request body is parsed as `multipart/form-data` and all
   * files under `config.fieldName` (default `"files"`) are surfaced at `c.files`.
   * Any remaining form fields are validated against the `body` schema.
   */
  files?: FilesConfig;
};

type InferSchemaValue<TSchema extends z.ZodTypeAny | undefined> =
  TSchema extends z.ZodTypeAny ? z.infer<TSchema> : unknown;

export type InferRouteResponsePayload<
  TResponse extends RouteResponseSchema | undefined,
> =
  TResponse extends z.ZodTypeAny
    ? z.infer<TResponse>
    : TResponse extends RouteResponseSchemaMap
      ? z.infer<TResponse[keyof TResponse & number]>
      : unknown;

type InferThrowSchemaEntry<TThrows, TStatus extends number> =
  TThrows extends RouteThrowsSchema
    ? TStatus extends keyof TThrows & number
      ? TThrows[TStatus]
      : never
    : never;

type InferDataField<TData> = [TData] extends [void] | [undefined]
  ? { data?: TData }
  : { data: TData };

type InferIssueField<TIssues> = [TIssues] extends [void] | [undefined]
  ? { issues?: ApiErrorIssue[] }
  : { issues?: TIssues };

type InferIssueItem<TIssues> = TIssues extends Array<infer TIssue>
  ? TIssue
  : ApiErrorIssue;
type NormalizeIssues<TIssues> = [TIssues] extends [never]
  ? ApiErrorIssue[]
  : TIssues;

type InferThrowData<TThrowSchema> = TThrowSchema extends z.ZodTypeAny
  ? z.infer<TThrowSchema>
  : TThrowSchema extends RouteThrowDescriptor
    ? TThrowSchema["data"] extends z.ZodTypeAny
      ? z.infer<TThrowSchema["data"]>
      : void
    : never;

type InferThrowIssues<TThrowSchema> = TThrowSchema extends RouteThrowDescriptor
  ? TThrowSchema["issues"] extends z.ZodTypeAny
    ? z.infer<TThrowSchema["issues"]>
    : ApiErrorIssue[]
  : ApiErrorIssue[];

type InferThrowOptionsForStatus<TThrows, TStatus extends number> =
  InferThrowSchemaEntry<TThrows, TStatus> extends infer TEntry
    ? TEntry extends RouteThrowSchema
      ? InferDataField<InferThrowData<TEntry>> &
          InferIssueField<InferThrowIssues<TEntry>> & {
          status: TStatus;
          message?: string;
          headers?: Record<string, string>;
        }
      : TEntry extends RouteThrowsCodeSchemaMap
        ? {
            [TCode in keyof TEntry & string]: {
              status: TStatus;
              code: TCode;
              message?: string;
              headers?: Record<string, string>;
            } & InferDataField<InferThrowData<TEntry[TCode]>> &
              InferIssueField<InferThrowIssues<TEntry[TCode]>>;
          }[keyof TEntry & string]
        : never
    : never;

type InferThrowOptions<TThrows extends RouteThrowsSchema | undefined> =
  TThrows extends RouteThrowsSchema
    ? {
        [TStatus in keyof TThrows & number]: InferThrowOptionsForStatus<
          TThrows,
          TStatus
        >;
      }[keyof TThrows & number]
    : {
        status: ErrorStatusCode;
        code?: string;
        message?: string;
        data?: unknown;
        issues?: ApiErrorIssue[];
        headers?: Record<string, string>;
      };

type ExpandUnion<TValue> = TValue extends unknown
  ? { [TKey in keyof TValue]: TValue[TKey] }
  : never;

type InferExplicitResponseOptions<TResponse extends RouteResponseSchema | undefined> =
  TResponse extends RouteResponseSchemaMap
    ? {
        [TStatus in keyof TResponse & number]: {
          status: TStatus;
          data: z.infer<TResponse[TStatus]>;
          code?: string;
          message?: string;
          issues?: ApiErrorIssue[];
          headers?: Record<string, string>;
        };
      }[keyof TResponse & number]
    : {
        status: SuccessStatusCode;
        data: InferRouteResponsePayload<TResponse>;
        code?: string;
        message?: string;
        issues?: ApiErrorIssue[];
        headers?: Record<string, string>;
      };

export type ExplicitRouteResponse<
  TResponse extends RouteResponseSchema | undefined = undefined,
> = {
  readonly _kind: "explicit_route_response";
  readonly status: number;
  readonly data: unknown;
  readonly code?: string;
  readonly message?: string;
  readonly issues?: ApiErrorIssue[];
  readonly headers?: Record<string, string>;
};

export type TypedJsonResponder<TResponse extends RouteResponseSchema | undefined> =
  TResponse extends RouteResponseSchemaMap
    ? <TStatus extends keyof TResponse & number>(
        payload: z.infer<TResponse[TStatus]>,
        status: TStatus,
        headers?: Record<string, string>,
      ) => Response
    : (
        payload: InferRouteResponsePayload<TResponse>,
        status?: number,
        headers?: Record<string, string>,
      ) => Response;

export type TypedRouteResponseFactory<
  TResponse extends RouteResponseSchema | undefined,
> = (
  /**
   * Explicit response shape used by `context.response(...)`.
   *
   * Example:
   * `context.response({ status: 200, data: user })`
   * `context.response({ status: 200, data: user, code: "USER_OK", message: "Fetched", issues: [] })`
   */
  response: InferExplicitResponseOptions<TResponse>,
) => ExplicitRouteResponse<TResponse>;

export type TypedRouteReturnValidator<
  TResponse extends RouteResponseSchema | undefined,
> = (
  payload: InferRouteResponsePayload<TResponse>,
) => InferRouteResponsePayload<TResponse>;

export type TypedRouteErrorFactory<
  TThrows extends RouteThrowsSchema | undefined,
> = (
  /**
   * Creates a typed `ApiError` from an explicit error object.
   *
   * Example:
   * `context.error({ status: 404 })`
   * `context.error({ status: 422, code: "INVALID_INPUT", data: {...} })`
   */
  error: ExpandUnion<InferThrowOptions<TThrows>>,
) => ApiError<ApiErrorIssue>;

type InferFileContext<TSchema extends RouteSchema> = [TSchema["file"]] extends [
  FileConfig,
]
  ? TSchema["file"] extends { required: false }
    ? { file: UploadedFile | undefined }
    : { file: UploadedFile }
  : {};

type InferFilesContext<TSchema extends RouteSchema> = [
  TSchema["files"],
] extends [FilesConfig]
  ? { files: UploadedFile[] }
  : {};

export type TypedRouteContext<
  TSchema extends RouteSchema,
  TParamsSchema extends RouteParamsSchema | undefined = undefined,
  TContextExtensions extends object = {},
> = TypedRouteContextWithParamsValue<
  TSchema,
  InferSchemaValue<TParamsSchema>,
  {},
  TContextExtensions
>;

/**
 * Lower-level context type that accepts an already-resolved params value
 * (e.g. merged across procedures + route) and a typed `procedures` bag.
 *
 * `TypedRouteContext` delegates to this — use this form when you already
 * computed the merged params shape upstream in the builder.
 */
export type TypedRouteContextWithParamsValue<
  TSchema extends RouteSchema,
  TParamsValue,
  TProcedures extends object = {},
  TContextExtensions extends object = {},
> = Omit<
  Context,
  "json" | "body" | "error"
> &
  Simplify<{
  /**
   * Parsed and validated request body.
   */
  body: InferSchemaValue<TSchema["body"]>;
  /**
   * Parsed and validated query string values.
   */
  query: InferSchemaValue<TSchema["query"]>;
  /**
   * Parsed and validated request headers.
   */
  headers: InferSchemaValue<TSchema["headers"]>;
  /**
   * Parsed and validated route params from dynamic path segments.
   */
  params: TParamsValue;
  /**
   * Contributions returned by applied procedures, keyed by the property
   * names they returned from their handlers.
   */
  procedures: TProcedures;
  /**
   * Sends JSON response payloads constrained by `response` schema.
   */
  json: TypedJsonResponder<TSchema["response"]>;
  /**
   * Type-check helper for implicit return payloads.
   */
  returns: TypedRouteReturnValidator<TSchema["response"]>;
  /**
   * Creates explicit typed responses with metadata (`code`, `message`, `issues`).
   */
  response: TypedRouteResponseFactory<TSchema["response"]>;
  /**
   * Creates typed `ApiError` values based on declared `throws` schema.
   */
  error: TypedRouteErrorFactory<TSchema["throws"]>;
  }> &
  InferFileContext<TSchema> &
  InferFilesContext<TSchema> &
  TContextExtensions;
