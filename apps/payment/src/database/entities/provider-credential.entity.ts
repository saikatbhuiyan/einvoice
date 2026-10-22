import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * An organization's own account with a payment provider (today: its SSLCommerz store). The secret
 * is stored only encrypted (CredentialCipher, AES-256-GCM) and never leaves payment: the API can set
 * or replace it, never read it back.
 */
@Entity({ name: 'provider_credentials' })
@Index('UQ_provider_credentials_organization_provider', ['organizationId', 'provider'], { unique: true })
export class ProviderCredentialEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  /** The provider's public account id (SSLCommerz store_id): shown back, not secret. */
  @Column({ type: 'varchar', length: 64 })
  accountId!: string;

  /** `v1:<keyId>:<nonce>:<tag>:<ciphertext>` -- see CredentialCipher. Never plaintext. */
  @Column({ type: 'text' })
  secretCiphertext!: string;

  /** Which PAYMENT_CREDENTIALS_KEY encrypted it (also inside the ciphertext): finds rows to re-encrypt on rotation. */
  @Column({ type: 'varchar', length: 16 })
  keyId!: string;

  /** The provider's test environment (no real money) rather than live. */
  @Column({ type: 'boolean', default: false })
  sandbox!: boolean;

  /**
   * Disconnected by the organization: new checkouts no longer use it, but it is kept so payments
   * already started through it can still be confirmed with SSLCommerz. Reconnecting clears it.
   */
  @Column({ type: 'timestamptz', nullable: true })
  disabledAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
