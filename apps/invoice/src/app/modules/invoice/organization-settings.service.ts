import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { tenantCacheKey } from '@libs/cache';
import type { OrganizationInvoiceSettings } from '@libs/interfaces/gateway';
import { OrganizationClientService } from './clients/organization-client.service';

const SETTINGS_TTL_MS = 60_000;

/**
 * The current organization's invoicing settings (prefix, reminder schedule), owned by user-access.
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
    const key = tenantCacheKey('svc', 'org-settings');
    try {
      const cached = await this.cache.get<OrganizationInvoiceSettings>(key);
      if (cached) return cached;
    } catch {
      this.logger.warn(`Cache read failed for key "${key}"`);
    }

    const settings = await this.organizations.findInvoiceSettings();
    try {
      await this.cache.set(key, settings, SETTINGS_TTL_MS);
    } catch {
      this.logger.warn(`Cache write failed for key "${key}"`);
    }
    return settings;
  }
}
