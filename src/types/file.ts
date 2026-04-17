/**
 * Uploaded file surfaced on the route context via `c.file` or `c.files`.
 *
 * Backed by the standard Web `File` API, so `await file.arrayBuffer()`,
 * `file.stream()`, `file.text()`, `file.name`, `file.type` and `file.size`
 * are all available.
 */
export type UploadedFile = File;

/**
 * Allowed file type matcher entry.
 *
 * Supported shapes:
 * - Exact MIME type: `"image/png"`
 * - MIME wildcard: `"image/*"`
 * - File extension: `".png"`
 */
export type AllowedFileType = string;

/**
 * Config for a single-file upload declared via `.file(...)`.
 *
 * The field name under which the file is expected in the multipart form
 * defaults to `"file"` when omitted.
 */
export type FileConfig = {
  /**
   * Multipart form field name. Defaults to `"file"`.
   */
  fieldName?: string;
  /**
   * Maximum accepted file size in bytes.
   *
   * Requests where the file exceeds this size are rejected with 400.
   */
  maxSize?: number;
  /**
   * Minimum accepted file size in bytes.
   */
  minSize?: number;
  /**
   * Allowed file type matchers. When omitted, any type is accepted.
   */
  allowedTypes?: AllowedFileType[];
  /**
   * Whether the file field must be present.
   *
   * Defaults to `true`. When set to `false`, `c.file` may be `undefined`.
   */
  required?: boolean;
};

/**
 * Config for a multi-file upload declared via `.files(...)`.
 *
 * The field name under which files are expected in the multipart form
 * defaults to `"files"` when omitted. All files under that field are
 * collected into `c.files`.
 */
export type FilesConfig = {
  /**
   * Multipart form field name. Defaults to `"files"`.
   */
  fieldName?: string;
  /**
   * Maximum accepted per-file size in bytes.
   */
  maxSize?: number;
  /**
   * Minimum accepted per-file size in bytes.
   */
  minSize?: number;
  /**
   * Maximum accepted total size in bytes summed across all uploaded files.
   */
  totalMaxSize?: number;
  /**
   * Allowed file type matchers. When omitted, any type is accepted.
   */
  allowedTypes?: AllowedFileType[];
  /**
   * Minimum number of files required. Defaults to `0`.
   */
  minCount?: number;
  /**
   * Maximum number of files accepted. When omitted, no upper bound is enforced.
   */
  maxCount?: number;
};
