import axios from 'axios';
import { randomUUID } from 'crypto';
import { bearer, tokenFor } from '../helpers/auth';

/**
 * The invoice lifecycle through the public gateway: bff (JWT + permissions + caching) → invoice
 * over TCP (RpcEnvelope + RpcPermissionGuard) → MongoDB. Complements invoice-e2e, which calls the
 * invoice service's own HTTP surface directly and so skips every gateway concern.
 */
describe('Invoice lifecycle through bff (e2e)', () => {
  let auth: ReturnType<typeof bearer>;

  beforeAll(async () => {
    auth = bearer(await tokenFor('accountant'));
  });

  const newInvoice = (overrides: Record<string, unknown> = {}) => ({
    invoiceNumber: `E2E-BFF-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    client: { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Main St' },
    items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 2, unitPrice: 50, vatRate: 10 }],
    currency: 'USD',
    ...overrides,
  });

  it('creates, reads, updates with If-Match, rejects a stale If-Match, and soft-deletes', async () => {
    const created = await axios.post('/invoices', newInvoice(), auth);
    expect(created.status).toBe(201);
    const { id, version, total } = created.data.data;
    expect(total).toBe(110);

    const fetched = await axios.get(`/invoices/${id}`, auth);
    expect(fetched.status).toBe(200);
    expect(fetched.data.data.id).toBe(id);

    const updated = await axios.patch(
      `/invoices/${id}`,
      { notes: 'Net 30' },
      { headers: { ...auth.headers, 'If-Match': String(version) } },
    );
    expect(updated.status).toBe(200);
    expect(updated.data.data.version).toBe(version + 1);

    const stale = await axios.patch(
      `/invoices/${id}`,
      { notes: 'lost update' },
      { headers: { ...auth.headers, 'If-Match': String(version) } },
    );
    expect(stale.status).toBe(409);

    const deleted = await axios.delete(`/invoices/${id}`, auth);
    expect(deleted.status).toBe(200);
    expect((await axios.get(`/invoices/${id}`, auth)).status).toBe(404);
  });

  // Totals are always server-computed; the gateway goes further and rejects a client that tries
  // to send them (forbidNonWhitelisted), rather than silently ignoring the field.
  it('rejects client-supplied totals at the gateway with 422', async () => {
    const response = await axios.post('/invoices', { ...newInvoice(), total: 1 }, auth);

    expect(response.status).toBe(422);
    expect(response.data.errors['/body/property']).toContain('total should not exist');
  });

  it('returns the same invoice for a retried idempotency key, even when retries race', async () => {
    const payload = newInvoice({ idempotencyKey: `e2e-${randomUUID()}` });

    const responses = await Promise.all([1, 2, 3].map(() => axios.post('/invoices', payload, auth)));

    expect(responses.map((r) => r.status).every((s) => s === 201 || s === 200)).toBe(true);
    expect(new Set(responses.map((r) => r.data.data.id)).size).toBe(1);
  });

  it('validates input at the gateway with 400/422 problem details', async () => {
    const response = await axios.post('/invoices', { ...newInvoice(), currency: 'XYZ' }, auth);

    expect([400, 422]).toContain(response.status);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('treats regex characters in search literally', async () => {
    const response = await axios.get('/invoices', { ...auth, params: { search: 'E2E(' } });

    expect(response.status).toBe(200);
  });
});
