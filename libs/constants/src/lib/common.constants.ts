export const PORT = 8000;
export const API_PREFIX = 'api';
export const API_VERSION = 'v1';

/** Allowed CORS HTTP methods — single source of truth for bootstrap CORS setup */
export const ALLOWED_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

/** Default pagination values shared across DTOs and service layers */
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Rate limit defaults (burst: max burst tokens, rate: tokens/sec) */
export const RATE_LIMIT_DEFAULT_BURST = 60;
export const RATE_LIMIT_DEFAULT_RATE = 4;
export const RATE_LIMIT_MUTATE_BURST = 10;
export const RATE_LIMIT_MUTATE_RATE = 0.5;
export const RATE_LIMIT_DELETE_BURST = 5;
export const RATE_LIMIT_DELETE_RATE = 0.2;

/** Request body size limit (bytes) */
export const BODY_SIZE_LIMIT = 100 * 1024;

/** Graceful shutdown drain timeout (ms) */
export const SHUTDOWN_DRAIN_TIMEOUT_MS = 30_000;

/** Named Mongoose connection for read replicas. Used by MongoDbModule, SchemasModule, and InvoiceModule. */
export const READ_DB = 'readDb';
