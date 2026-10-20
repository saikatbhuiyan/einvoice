import axios from 'axios';
import { DEFAULT_ORGANIZATION_ID } from '@libs/shared/types';
import { bearer, tokenFor } from '../helpers/auth';

/**
 * The active organization through the gateway: bff resolves it from the caller's memberships (via
 * authorizer and user-access over gRPC), never from the header alone.
 */
describe('Tenancy through bff (e2e)', () => {
  let token: string;

  beforeAll(async () => {
    token = await tokenFor('accountant');
  });

  it('GET /me reports the active organization, its permissions and every membership', async () => {
    const response = await axios.get('/me', bearer(token));

    expect(response.status).toBe(200);
    expect(response.data.data).toMatchObject({
      username: 'dev.accountant',
      activeOrganizationId: DEFAULT_ORGANIZATION_ID,
      permissions: expect.arrayContaining(['invoice:read', 'invoice:write']),
    });
    expect(response.data.data.memberships).toContainEqual(
      expect.objectContaining({ organizationId: DEFAULT_ORGANIZATION_ID, roleName: 'accountant' }),
    );
  });

  // The header is a request, not a claim: an organization you don't belong to is refused outright.
  it('refuses an organization the caller is not a member of with 403', async () => {
    const response = await axios.get('/invoices', bearer(token, '11111111-1111-4111-8111-111111111111'));

    expect(response.status).toBe(403);
    expect(response.data.detail).toMatch(/not a member of organization/);
  });

  it('numbers an invoice when it is issued, not when it is created', async () => {
    const created = await axios.post(
      '/invoices',
      {
        client: { name: 'Acme Corp', email: 'billing@acme.test', address: '1 Main St' },
        items: [{ catalogId: 'sku-1', name: 'Widget', quantity: 1, unitPrice: 10, vatRate: 0 }],
        currency: 'USD',
      },
      bearer(token),
    );
    expect(created.status).toBe(201);
    expect(created.data.data.invoiceNumber).toBeUndefined();

    const issued = await axios.post(`/invoices/${created.data.data.id}/issue`, undefined, bearer(token));
    expect(issued.status).toBe(200);
    expect(issued.data.data.invoiceNumber).toMatch(/^[A-Z0-9]+-\d{4}-\d{6,}$/);
  });
});
