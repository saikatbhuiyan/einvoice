import axios from 'axios';
import { randomUUID } from 'crypto';

/**
 * Exercises the invoice microservice's real HTTP surface end to end.
 * Requires Mongo + Redis reachable (e.g. `docker compose -f docker-compose.dev.yml up -d redis mongodb`)
 * and the invoice app served with `.env`/`.env.dev` loaded, which `nx e2e invoice-e2e` sets up via its
 * `dependsOn: ["invoice:build", "invoice:serve"]` target dependency.
 */
describe('Invoice CRUD (e2e)', () => {
  const basePath = '/api/invoices';

  const buildPayload = (overrides: Record<string, unknown> = {}) => ({
    invoiceNumber: `E2E-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    client: { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Infinite Loop, Cupertino' },
    items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 2, unitPrice: 50, vatRate: 10 }],
    currency: 'USD',
    ...overrides,
  });

  it('creates an invoice with server-computed totals', async () => {
    const res = await axios.post(basePath, buildPayload());

    expect(res.status).toBe(201);
    expect(res.data.subtotal).toBe(100);
    expect(res.data.vatTotal).toBe(10);
    expect(res.data.total).toBe(110);
    expect(res.data.items[0].total).toBe(110);
    expect(res.data.id).toBeDefined();
    expect(res.data.version).toBeDefined();
  });

  it('retrieves a created invoice by id', async () => {
    const created = await axios.post(basePath, buildPayload());

    const res = await axios.get(`${basePath}/${created.data.id}`);

    expect(res.status).toBe(200);
    expect(res.data.id).toBe(created.data.id);
    expect(res.data.invoiceNumber).toBe(created.data.invoiceNumber);
  });

  it('returns 404 for an invoice that does not exist', async () => {
    await expect(axios.get(`${basePath}/507f1f77bcf86cd799439011`)).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  it('finds a created invoice through the offset-paginated list with a search filter', async () => {
    const created = await axios.post(basePath, buildPayload());

    const res = await axios.get(basePath, {
      params: { search: created.data.invoiceNumber, page: 1, limit: 10 },
    });

    expect(res.status).toBe(200);
    expect(res.data.meta).toMatchObject({ page: 1, limit: 10 });
    expect(res.data.items.map((item: { id: string }) => item.id)).toContain(created.data.id);
  });

  it('lists invoices in cursor mode when a cursor is supplied', async () => {
    await axios.post(basePath, buildPayload());
    // An all-Fs ObjectId cursor is greater than any real id, so `_id < cursor` matches everything.
    const farFutureCursor = Buffer.from('ffffffffffffffffffffffff').toString('base64url');

    const res = await axios.get(basePath, { params: { cursor: farFutureCursor, limit: 1 } });

    expect(res.status).toBe(200);
    expect(res.data.meta).toMatchObject({ limit: 1 });
    expect(res.data.meta).not.toHaveProperty('page');
    expect(res.data.items.length).toBeLessThanOrEqual(1);
  });

  it('updates an invoice with a matching If-Match version, then rejects a stale retry with 409', async () => {
    const created = await axios.post(basePath, buildPayload());
    const id = created.data.id;
    const originalVersion = created.data.version;

    const updated = await axios.patch(
      `${basePath}/${id}`,
      { notes: 'Updated via e2e test' },
      { headers: { 'if-match': String(originalVersion) } },
    );

    expect(updated.status).toBe(200);
    expect(updated.data.notes).toBe('Updated via e2e test');

    await expect(
      axios.patch(`${basePath}/${id}`, { notes: 'Stale update' }, { headers: { 'if-match': String(originalVersion) } }),
    ).rejects.toMatchObject({ response: { status: 409 } });
  });

  it('returns the same invoice for a repeated idempotency key instead of creating a duplicate', async () => {
    const idempotencyKey = randomUUID();

    const first = await axios.post(basePath, buildPayload({ idempotencyKey }));
    const second = await axios.post(
      basePath,
      buildPayload({ idempotencyKey, invoiceNumber: `DIFFERENT-${Date.now()}` }),
    );

    expect(second.data.id).toBe(first.data.id);
    expect(second.data.invoiceNumber).toBe(first.data.invoiceNumber);
  });

  it('soft-deletes an invoice so it is excluded from future reads', async () => {
    const created = await axios.post(basePath, buildPayload());
    const id = created.data.id;

    const deleteRes = await axios.delete(`${basePath}/${id}`, {
      headers: { 'if-match': String(created.data.version) },
    });

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.data).toEqual({ id, deleted: true });

    await expect(axios.get(`${basePath}/${id}`)).rejects.toMatchObject({ response: { status: 404 } });

    const listRes = await axios.get(basePath, { params: { search: created.data.invoiceNumber } });
    expect(listRes.data.items.map((item: { id: string }) => item.id)).not.toContain(id);
  });
});
