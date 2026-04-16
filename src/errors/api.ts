import { STATUS_CODES } from "node:http";

/**
 * A single issue entry for `ApiError.issues`.
 *
 * Think of this as a sub-error item you can attach for validation-style feedback.
 */
export type ApiErrorIssue = {
  /**
   * Optional object path that points to the failing value.
   * Example: `["body", "email"]`
   */
  path?: Array<string | number>;
  /**
   * Optional machine-readable issue code.
   */
  code?: string;
  /**
   * Human-readable issue message.
   */
  message: string;
  /**
   * Optional additional metadata for clients.
   */
  details?: unknown;
};

export function getStatusMessage(status: number): string {
  const statusMessage = STATUS_CODES[status];
  return typeof statusMessage === "string" && statusMessage.length > 0
    ? statusMessage
    : String(status);
}

/**
 * Construction options for `ApiError`.
 */
export type ApiErrorInit<TIssue = ApiErrorIssue> = {
  /**
   * HTTP status. Runtime validation expects thrown statuses to be 4xx.
   */
  status: number;
  /**
   * Stable machine-readable business code.
   * Example: `USER_NOT_FOUND`
   */
  code?: string;
  /**
   * Structured payload to expose in error responses.
   */
  data?: unknown;
  /**
   * Optional override for default status text.
   */
  message?: string;
  /**
   * Optional issue/sub-error list.
   */
  issues?: TIssue[];
  /**
   * Optional response headers.
   */
  headers?: Record<string, string>;
};

/**
 * Domain error used by route handlers and runtime normalization.
 */
export class ApiError<TIssue = ApiErrorIssue> extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly data?: unknown;
  public readonly headers?: Record<string, string>;
  public readonly issues: TIssue[];

  public constructor(status: number);
  public constructor(init: ApiErrorInit<TIssue>);
  public constructor(statusOrInit: number | ApiErrorInit<TIssue>) {
    const init =
      typeof statusOrInit === "number"
        ? { status: statusOrInit }
        : statusOrInit;
    super(init.message ?? getStatusMessage(init.status));

    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.data = init.data;
    this.headers = init.headers;
    this.issues = [...(init.issues ?? [])];
  }

  public addIssue(issue: TIssue): this {
    this.issues.push(issue);
    return this;
  }

  public addIssues(issues: TIssue[]): this {
    this.issues.push(...issues);
    return this;
  }
}
