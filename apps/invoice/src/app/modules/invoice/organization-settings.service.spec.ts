import { itInOrganization as it, TEST_ORGANIZATION_ID as ORG } from '@libs/logging/testing';
import { OrganizationSettingsService } from './organization-settings.service';

describe('OrganizationSettingsService', () => {
  const SETTINGS = {
    invoicePrefix: 'ACME',
    reminderOffsetsDays: [1, 7, 14],
    timeZone: 'Asia/Dhaka',
    issuer: { name: 'Acme Ltd.', bin: '0012345670101', address: 'Road 8, Dhaka', authorizedSignatory: null },
  };
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

    // v2: entries cached in the shape before timeZone/issuer existed are never read back.
    expect(cache.get).toHaveBeenCalledWith(`svc:org:${ORG}:org-settings:v2`);
    expect(cache.set).toHaveBeenCalledWith(`svc:org:${ORG}:org-settings:v2`, SETTINGS, 60_000);
  });

  // Mid-rollout, user-access may still be the version that answers without them.
  it('treats an answer without timeZone or issuer as UTC and no issuer details', async () => {
    organizations.findInvoiceSettings.mockResolvedValue({ invoicePrefix: 'ACME', reminderOffsetsDays: [1] });

    await expect(service.current()).resolves.toEqual({
      invoicePrefix: 'ACME',
      reminderOffsetsDays: [1],
      timeZone: 'UTC',
      issuer: { name: '', bin: null, address: null, authorizedSignatory: null },
    });
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
