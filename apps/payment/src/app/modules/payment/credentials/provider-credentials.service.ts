import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { requireOrganizationId } from '@libs/logging/correlation-context';
import type { SslCommerzCredentialsRequest, SslCommerzCredentialsResponse } from '@libs/interfaces/gateway';
import { ProviderCredentialEntity } from '../../../../database/entities/provider-credential.entity';
import { SSLCOMMERZ_OPTIONS, type SslCommerzOptions } from '../sslcommerz/sslcommerz.options';
import { CredentialCipher } from './credential-cipher';
import {
  SslCommerzClient,
  SslCommerzUnavailableError,
  type SslCommerzCredentials,
} from '../sslcommerz/sslcommerz.client';

const SSLCOMMERZ = 'sslcommerz';
const STORE_ID = /^[A-Za-z0-9_-]{1,30}$/;

/**
 * The current organization's own SSLCommerz store (requireOrganizationId()). The password is
 * write-only: stored encrypted (CredentialCipher), decrypted only to call SSLCommerz, never returned.
 */
@Injectable()
export class ProviderCredentialsService {
  private readonly logger = new Logger(ProviderCredentialsService.name);
  private readonly cipher: CredentialCipher | null;

  constructor(
    @InjectRepository(ProviderCredentialEntity) private readonly credentials: Repository<ProviderCredentialEntity>,
    private readonly sslcommerz: SslCommerzClient,
    @Inject(SSLCOMMERZ_OPTIONS) options: SslCommerzOptions,
  ) {
    this.cipher = options.credentialsKey ? new CredentialCipher(options.credentialsKey) : null;
  }

  async getSslCommerz(): Promise<SslCommerzCredentialsResponse> {
    const stored = await this.find();
    if (!stored) throw new NotFoundException('No SSLCommerz store is connected to this organization.');
    return this.toResponse(stored);
  }

  /** Whether BDT invoices of the current organization go to SSLCommerz. */
  async hasSslCommerz(): Promise<boolean> {
    return this.credentials.exists({
      where: { organizationId: requireOrganizationId(), provider: SSLCOMMERZ, disabledAt: IsNull() },
    });
  }

  /**
   * Connects (or replaces) the store, after SSLCommerz itself accepts the credentials -- a typo
   * found now beats a payer finding it at checkout. Re-validated here: RPC payloads skip DTO validation.
   */
  async setSslCommerz(request: SslCommerzCredentialsRequest): Promise<SslCommerzCredentialsResponse> {
    const cipher = this.requireCipher();
    const { storeId, storePassword, sandbox } = request ?? ({} as SslCommerzCredentialsRequest);
    if (typeof storeId !== 'string' || !STORE_ID.test(storeId)) {
      throw new UnprocessableEntityException('storeId must be 1-30 letters, digits, - or _.');
    }
    if (typeof storePassword !== 'string' || storePassword.length < 1 || storePassword.length > 64) {
      throw new UnprocessableEntityException('storePassword must be 1-64 characters.');
    }
    if (typeof sandbox !== 'boolean') {
      throw new UnprocessableEntityException('sandbox must be true or false.');
    }

    let accepted: boolean;
    try {
      accepted = await this.sslcommerz.checkCredentials({ storeId, storePassword, sandbox });
    } catch (error) {
      if (error instanceof SslCommerzUnavailableError) {
        throw new ServiceUnavailableException('SSLCommerz could not be reached to check the store; try again.');
      }
      throw error;
    }
    if (!accepted) {
      throw new UnprocessableEntityException(
        `SSLCommerz refused these ${sandbox ? 'sandbox' : 'live'} store credentials (wrong, or the store is inactive).`,
      );
    }

    const organizationId = requireOrganizationId();
    await this.credentials.upsert(
      {
        organizationId,
        provider: SSLCOMMERZ,
        accountId: storeId,
        secretCiphertext: cipher.encrypt(storePassword),
        keyId: cipher.keyId,
        sandbox,
        disabledAt: null,
      },
      { conflictPaths: ['organizationId', 'provider'] },
    );
    this.logger.log(
      `Organization ${organizationId} connected SSLCommerz store "${storeId}" (${sandbox ? 'sandbox' : 'live'}).`,
    );
    return this.getSslCommerz();
  }

  /**
   * Disconnects the store: new BDT checkouts go to Stripe again. The credentials are kept (disabled),
   * not deleted -- a payer may still complete a session started through this store, and confirming
   * that payment means asking SSLCommerz with them.
   */
  async deleteSslCommerz(): Promise<{ provider: 'sslcommerz'; deleted: true }> {
    const { affected } = await this.credentials.update(
      { organizationId: requireOrganizationId(), provider: SSLCOMMERZ, disabledAt: IsNull() },
      { disabledAt: new Date() },
    );
    if (!affected) throw new NotFoundException('No SSLCommerz store is connected to this organization.');
    return { provider: SSLCOMMERZ, deleted: true };
  }

  /**
   * The decrypted store credentials, for calling SSLCommerz on the current organization's behalf.
   * `forSettlement`: a disconnected store still counts -- confirming a payment already started
   * through it needs its credentials; starting a new one must not use it.
   */
  async resolveSslCommerz({ forSettlement = false } = {}): Promise<SslCommerzCredentials> {
    const stored = await this.find({ includeDisabled: forSettlement });
    if (!stored) throw new NotFoundException('No SSLCommerz store is connected to this organization.');
    return {
      storeId: stored.accountId,
      storePassword: this.requireCipher().decrypt(stored.secretCiphertext),
      sandbox: stored.sandbox,
    };
  }

  private find({ includeDisabled = false } = {}): Promise<ProviderCredentialEntity | null> {
    return this.credentials.findOne({
      where: {
        organizationId: requireOrganizationId(),
        provider: SSLCOMMERZ,
        ...(includeDisabled ? {} : { disabledAt: IsNull() }),
      },
    });
  }

  private requireCipher(): CredentialCipher {
    if (!this.cipher) {
      throw new ServiceUnavailableException(
        'SSLCommerz is not set up on this server (PAYMENT_CREDENTIALS_KEY is missing).',
      );
    }
    return this.cipher;
  }

  private toResponse(stored: ProviderCredentialEntity): SslCommerzCredentialsResponse {
    return { provider: SSLCOMMERZ, storeId: stored.accountId, sandbox: stored.sandbox, configuredAt: stored.updatedAt };
  }
}
