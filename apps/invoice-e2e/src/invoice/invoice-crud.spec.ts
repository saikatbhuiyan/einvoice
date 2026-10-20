import axios from 'axios';
import { randomUUID } from 'crypto';
import { DEFAULT_ORGANIZATION_ID } from '@libs/shared/types';

/**
 * Exercises the invoice microservice's real HTTP surface end to end, in the default organization
 * (see support/test-setup.ts). Prerequisites: support/global-setup.ts.
 */
describe('Invoice CRUD (e2e)', () => {
  const basePath = '/api/invoices';

  const buildPayload = (overrides: Record<string, unknown> = {}) => ({
    reference: `E2E-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    client: { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Infinite Loop, Cupertino' },
    items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 2, unitPrice: 50, vatRate: 10 }],
    currency: 'USD',
    ...overrides,
  });

  it('creates an unnumbered draft with server-computed totals, ignoring a client-supplied number', async () => {
    const res = await axios.post(basePath, buildPayload({ invoiceNumber: 'INV-2026-000001' })).catch((e) => e.response);

    // Unknown fields are rejected by the validation pipe, so a client can't even try to pick a number.
    expect(res.status).toBe(422);

    const created = await axios.post(basePath, buildPayload());
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ status: 'draft', organizationId: DEFAULT_ORGANIZATION_ID });
    expect(created.data).not.toHaveProperty('invoiceNumber');
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
    expect(res.data.reference).toBe(created.data.reference);
  });

  it('returns 404 for an invoice that does not exist', async () => {
    await expect(axios.get(`${basePath}/507f1f77bcf86cd799439011`)).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  it('finds a created invoice through the offset-paginated list with a search filter', async () => {
    const created = await axios.post(basePath, buildPayload());

    const res = await axios.get(basePath, {
      params: { search: created.data.reference, page: 1, limit: 10 },
    });

    expect(res.status).toBe(200);
    expect(res.data.meta).toMatchObject({ page: 1, limit: 10 });
    expect(res.data.items.map((item: { id: string }) => item.id)).toContain(created.data.id);
  });

  it('starts cursor pagination with pagination=cursor and follows the returned cursor', async () => {
    const older = await axios.post(basePath, buildPayload());
    const newer = await axios.post(basePath, buildPayload());

    const first = await axios.get(basePath, { params: { pagination: 'cursor', limit: 1 } });
    expect(first.status).toBe(200);
    expect(first.data.meta).toMatchObject({ limit: 1, hasNextPage: true });
    expect(first.data.meta).not.toHaveProperty('total');
    expect(first.data.items.map((item: { id: string }) => item.id)).toEqual([newer.data.id]);

    const second = await axios.get(basePath, { params: { cursor: first.data.meta.cursor, limit: 1 } });
    expect(second.status).toBe(200);
    expect(second.data.items.map((item: { id: string }) => item.id)).toEqual([older.data.id]);
  });

  it('rejects pagination=cursor combined with page', async () => {
    await expect(axios.get(basePath, { params: { pagination: 'cursor', page: 2 } })).rejects.toMatchObject({
      response: { status: 422 },
    });
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
    const second = await axios.post(basePath, buildPayload({ idempotencyKey, reference: `DIFFERENT-${Date.now()}` }));

    expect(second.data.id).toBe(first.data.id);
    expect(second.data.reference).toBe(first.data.reference);
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

    const listRes = await axios.get(basePath, { params: { search: created.data.reference } });
    expect(listRes.data.items.map((item: { id: string }) => item.id)).not.toContain(id);
  });
});
