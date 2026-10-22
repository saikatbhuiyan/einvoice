import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Each organization's own payment-provider account (its SSLCommerz store). The secret column only
 * ever holds CredentialCipher output; a disconnected store is disabled, not deleted. Purely
 * additive: payments is untouched.
 */
export class AddProviderCredentials1792686549473 implements MigrationInterface {
  name = 'AddProviderCredentials1792686549473';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "provider_credentials" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "provider" character varying(32) NOT NULL, "accountId" character varying(64) NOT NULL, "secretCiphertext" text NOT NULL, "keyId" character varying(16) NOT NULL, "sandbox" boolean NOT NULL DEFAULT false, "disabledAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_31f2884572a5fef8e25a08b5a59" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_provider_credentials_organization_provider" ON "provider_credentials" ("organizationId", "provider") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_provider_credentials_organization_provider"`);
    await queryRunner.query(`DROP TABLE "provider_credentials"`);
  }
}
