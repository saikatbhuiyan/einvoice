import axios from 'axios';

// INVOICE_HTTP_PORT is the variable the invoice app listens on. Not the generic PORT: Nx injects
// the workspace-root .env into every task, and that sets PORT=3300 (bff's port).
module.exports = async function () {
  const host = process.env['HOST'] ?? 'localhost';
  const port = process.env['INVOICE_HTTP_PORT'] ?? '3302';
  axios.defaults.baseURL = `http://${host}:${port}`;
};
