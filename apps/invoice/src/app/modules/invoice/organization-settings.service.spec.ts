import { itInOrganization as it, TEST_ORGANIZATION_ID as ORG } from '@libs/logging/testing';
import { OrganizationSettingsService } from './organization-settings.service';

describe('OrganizationSettingsService', () => {
  const SETTINGS = { invoicePrefix: 'ACME', reminderOffsetsDays: [1, 7, 14] };
  let organizations: { findInvoiceSettings: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: OrganizationSettingsService;

  beforeEach(() => {
    organizations = { findInvoiceSettings: jest.fn().mockResolvedValue(SETTINGS) };
    cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn().mockResolvedValue(undefined) };
    service = new OrganizationSettingsService(organizations as never, cache as never);
  });

  it('asks user-access on a miss and caches the answer per organization for a minute', async () => {
    await expect(service.current()).resolves.toEqual(SETTINGS);

    expect(cache.get).toHaveBeenCalledWith(`svc:org:${ORG}:org-settings`);
    expect(cache.set).toHaveBeenCalledWith(`svc:org:${ORG}:org-settings`, SETTINGS, 60_000);
  });

  it('uses cached settings without calling user-access', async () => {
    cache.get.mockResolvedValue({ invoicePrefix: 'CACHED', reminderOffsetsDays: [] });

    await expect(service.current()).resolves.toMatchObject({ invoicePrefix: 'CACHED' });
    expect(organizations.findInvoiceSettings).not.toHaveBeenCalled();
  });

  it('still answers when the cache is down', async () => {
    cache.get.mockRejectedValue(new Error('redis down'));
    cache.set.mockRejectedValue(new Error('redis down'));

    await expect(service.current()).resolves.toEqual(SETTINGS);
  });
});
