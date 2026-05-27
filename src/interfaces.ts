export type CreateSendErrorName =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'validation_error'
  | 'not_found'
  | 'method_not_allowed'
  | 'rate_limit_exceeded'
  | 'application_error'
  | 'internal_server_error'
  | 'unknown_error';

export type ErrorResponse = {
  message: string;
  statusCode: number | null;
  name: CreateSendErrorName;
  code?: number;
};

export type Response<T> =
  | { data: T; error: null; headers: Record<string, string> | null }
  | { data: null; error: ErrorResponse; headers: Record<string, string> | null };

export type CreateSendOptions = {
  baseUrl?: string;
  userAgent?: string;
  fetch?: typeof fetch;
};
