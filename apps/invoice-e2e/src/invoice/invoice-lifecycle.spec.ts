import axios from 'axios';
import { randomUUID } from 'crypto';

/**
 * The invoice lifecycle end to end over the real HTTP surface: status only changes through the
 * lifecycle endpoints, and an issued invoice's content is immutable. `send` is not covered here —
 * it needs pdf-generator and media running, which this suite deliberately doesn't start.
 */
describe('Invoice lifecycle (e2e)', () => {
  const basePath = '/api/invoices';

  const createDraft = async () => {
    const res = await axios.post(basePath, {
      reference: `LC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      client: { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Infinite Loop, Cupertino' },
      items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPrice: 100, vatRate: 0 }],
      currency: 'USD',
    });
    return res.data as { id: string; status: string; version: number };
  };

  const statusOf = (promise: Promise<unknown>) =>
    promise.then(
      (res) => (res as { status: number }).status,
      (error: { response?: { status: number } }) => error.response?.status,
    );

  it('creates every invoice as a draft and refuses a status in the create or update body', async () => {
    const draft = await createDraft();
    expect(draft.status).toBe('draft');

    expect(await statusOf(axios.patch(`${basePath}/${draft.id}`, { status: 'paid' }))).toBe(422);
    expect((await axios.get(`${basePath}/${draft.id}`)).data.status).toBe('draft');
  });

  it('issues a draft, after which it can no longer be edited or deleted', async () => {
    const draft = await createDraft();

    const issued = await axios.post(`${basePath}/${draft.id}/issue`);
    expect(issued.status).toBe(200);
    expect(issued.data).toMatchObject({ status: 'issued', version: draft.version + 1 });

    const edit = await axios.patch(`${basePath}/${draft.id}`, { notes: 'too late' }).catch((error) => error.response);
    expect(edit.status).toBe(409);
    expect(edit.data.message).toMatch(/Invoice is issued; only draft invoices can be edited/);

    expect(await statusOf(axios.delete(`${basePath}/${draft.id}`))).toBe(409);
    const stored = (await axios.get(`${basePath}/${draft.id}`)).data;
    expect(stored.status).toBe('issued');
    expect(stored.notes).toBeUndefined();
  });

  it('cancels an issued invoice idempotently, and a cancelled invoice cannot be issued again', async () => {
    const draft = await createDraft();
    await axios.post(`${basePath}/${draft.id}/issue`);

    expect((await axios.post(`${basePath}/${draft.id}/cancel`)).data.status).toBe('cancelled');
    // A retried cancel (e.g. after a client timeout) succeeds without changing anything.
    expect((await axios.post(`${basePath}/${draft.id}/cancel`)).status).toBe(200);
    expect(await statusOf(axios.post(`${basePath}/${draft.id}/issue`))).toBe(409);
  });

  it('refuses to cancel a draft (drafts are deleted instead)', async () => {
    const draft = await createDraft();

    expect(await statusOf(axios.post(`${basePath}/${draft.id}/cancel`))).toBe(409);
    expect((await axios.delete(`${basePath}/${draft.id}`)).status).toBe(200);
  });

  it('returns 404 for a lifecycle action on an unknown invoice', async () => {
    expect(await statusOf(axios.post(`${basePath}/507f1f77bcf86cd799439011/issue`))).toBe(404);
  });

  describe('numbering', () => {
    const NUMBER = /^([A-Z0-9]+)-(\d{4})-(\d{6,})$/;

    it("numbers invoices on issue, consecutively, in the organization's format", async () => {
      const first = (await axios.post(`${basePath}/${(await createDraft()).id}/issue`)).data;
      const second = (await axios.post(`${basePath}/${(await createDraft()).id}/issue`)).data;

      const [, prefix, year, seq] = NUMBER.exec(first.invoiceNumber) ?? [];
      expect(year).toBe(String(new Date().getUTCFullYear()));
      expect(second.invoiceNumber).toBe(`${prefix}-${year}-${String(Number(seq) + 1).padStart(6, '0')}`);
    });

    it('keeps its number when issued again (a retried request)', async () => {
      const draft = await createDraft();
      const issued = (await axios.post(`${basePath}/${draft.id}/issue`)).data;

      expect((await axios.post(`${basePath}/${draft.id}/issue`)).data.invoiceNumber).toBe(issued.invoiceNumber);
    });
  });

  describe('tenancy', () => {
    it('is invisible from another organization: every route answers 404', async () => {
      const draft = await createDraft();
      const asOther = { headers: { 'x-organization-id': randomUUID() } };

      expect(await statusOf(axios.get(`${basePath}/${draft.id}`, asOther))).toBe(404);
      expect(await statusOf(axios.patch(`${basePath}/${draft.id}`, { notes: 'x' }, asOther))).toBe(404);
      expect(await statusOf(axios.post(`${basePath}/${draft.id}/issue`, undefined, asOther))).toBe(404);
      expect(await statusOf(axios.delete(`${basePath}/${draft.id}`, asOther))).toBe(404);
      const list = await axios.get(basePath, { ...asOther, params: { search: 'LC-' } });
      expect(list.data.items.map((item: { id: string }) => item.id)).not.toContain(draft.id);
      expect((await axios.get(`${basePath}/${draft.id}`)).data.status).toBe('draft');
    });

    it('refuses a tenant route without the organization header with a 400 naming it', async () => {
      const res = await axios
        .get(basePath, { headers: { 'x-organization-id': '' } })
        .catch((error: { response: { status: number; data: { detail: string } } }) => error.response);

      expect(res.status).toBe(400);
      expect(res.data.detail).toMatch(/x-organization-id/);
    });
  });
});
