import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { tenantCacheKey } from '@libs/cache';
import type { OrganizationInvoiceSettings } from '@libs/interfaces/gateway';
import { DEFAULT_TIME_ZONE } from '@libs/shared/types';
import { OrganizationClientService } from './clients/organization-client.service';

const SETTINGS_TTL_MS = 60_000;

/**
 * The current organization's invoicing settings (prefix, reminder schedule, time zone, and who
 * issues its invoices), owned by user-access.
 * Cached briefly per organization, so a change made by the organization's admin applies within a
 * minute; a cache outage degrades to asking user-access every time, never to an error.
 */
@Injectable()
export class OrganizationSettingsService {
  private readonly logger = new Logger(OrganizationSettingsService.name);

  constructor(
    private readonly organizations: OrganizationClientService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async current(): Promise<OrganizationInvoiceSettings> {
    // v2: the shape gained timeZone and issuer; an entry cached in the old shape is never read back.
    const key = tenantCacheKey('svc', 'org-settings', 'v2');
    try {
      const cached = await this.cache.get<OrganizationInvoiceSettings>(key);
      if (cached) return cached;
    } catch {
      this.logger.warn(`Cache read failed for key "${key}"`);
    }

    const settings = normalize(await this.organizations.findInvoiceSettings());
    try {
      await this.cache.set(key, settings, SETTINGS_TTL_MS);
    } catch {
      this.logger.warn(`Cache write failed for key "${key}"`);
    }
    return settings;
  }
}

/**
 * A user-access from before tax identities (mid-rollout) answers without timeZone or issuer: such an
 * organization behaves exactly as before -- UTC, and no seller details beyond what invoice can't know.
 */
function normalize(settings: OrganizationInvoiceSettings): OrganizationInvoiceSettings {
  return {
    ...settings,
    timeZone: settings.timeZone ?? DEFAULT_TIME_ZONE,
    issuer: settings.issuer ?? { name: '', bin: null, address: null, authorizedSignatory: null },
  };
}
