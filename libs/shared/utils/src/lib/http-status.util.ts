/** HTTP status code → human-readable title */
const statusTitleMap: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export function statusTitle(status: number): string {
  return statusTitleMap[status] ?? `HTTP Error ${status}`;
}

/** Status codes supported in RFC 7807 problem-detail responses */
const SUPPORTED_PROBLEM_CODES = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504] as const;

/** Common problem-detail titles keyed by HTTP status for OpenAPI / Swagger */
export const problemTitles: Record<number, string> = Object.fromEntries(
  Object.entries(statusTitleMap).filter(([code]) =>
    SUPPORTED_PROBLEM_CODES.includes(Number(code) as (typeof SUPPORTED_PROBLEM_CODES)[number]),
  ),
);
