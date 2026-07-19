/**
 * The API response envelope.
 *
 * Every JSON response — success or failure, from any module — has exactly one
 * of these two shapes. Clients branch on `success` and never guess at error
 * formats. The client workspace mirrors these types in its API layer.
 */

export interface ApiMeta {
  /** Correlation id for joining a response against server logs. */
  requestId: string;
  /** Extension point for pagination and similar per-endpoint metadata. */
  [key: string]: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

/** Stable, machine-readable error codes — part of the public API contract. */
export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

export interface ApiErrorDetail {
  /** Field path or subsystem the detail refers to. */
  field: string;
  message: string;
}

export interface ApiFailure {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetail[];
  };
  meta: ApiMeta;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
