export const PORT = 8000;
export const API_PREFIX = 'api';
export const API_VERSION = 'v1';

/** Allowed CORS HTTP methods — single source of truth for bootstrap CORS setup */
export const ALLOWED_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

/** Default pagination values shared across DTOs and service layers */
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Named Mongoose connection for read replicas. Used by MongoDbModule, SchemasModule, and InvoiceModule. */
export const READ_DB = 'readDb';
