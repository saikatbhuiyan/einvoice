import axios from 'axios';
import { DEFAULT_ORGANIZATION_ID, ORGANIZATION_HEADER } from '@libs/shared/types';

// INVOICE_HTTP_PORT is the variable the invoice app listens on. Not the generic PORT: Nx injects
// the workspace-root .env into every task, and that sets PORT=3300 (bff's port).
module.exports = async function () {
  const host = process.env['HOST'] ?? 'localhost';
  const port = process.env['INVOICE_HTTP_PORT'] ?? '3302';
  axios.defaults.baseURL = `http://${host}:${port}`;
  // invoice's internal API takes the organization from this header (bff resolves it from the
  // caller's memberships instead). The default organization: user-access's migration creates it,
  // and issuing needs a real one (its invoice prefix).
  axios.defaults.headers.common[ORGANIZATION_HEADER] = DEFAULT_ORGANIZATION_ID;
};
