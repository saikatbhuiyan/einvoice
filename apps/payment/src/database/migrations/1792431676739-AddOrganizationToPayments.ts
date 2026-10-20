import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The organization every pre-tenancy payment is moved into -- the same fixed id user-access's
 * AddOrganizationsAndMemberships migration creates (DEFAULT_ORGANIZATION_ID in @libs/shared/types;
 * a literal here because migrations avoid @libs/* aliases, see data-source.ts). Every existing
 * invoice moves into it too (invoice:backfill-tenancy), so their payments stay together.
 */
const DEFAULT_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Tenancy: each payment records its invoice's organization -- the Stripe webhook has no caller
 * organization, so marking the invoice paid runs in this one.
 *
 * Hand-edited from `payment:migration:generate`, which added the column as NOT NULL in one step --
 * that fails on any table that already has payments. Added nullable, backfilled, then constrained.
 * The index name is the generated one, so the schema matches the entity (the drift check).
 */
export class AddOrganizationToPayments1792431676739 implements MigrationInterface {
  name = 'AddOrganizationToPayments1792431676739';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" ADD "organizationId" uuid`);
    await queryRunner.query(`UPDATE "payments" SET "organizationId" = $1`, [DEFAULT_ORGANIZATION_ID]);
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "organizationId" SET NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_eca6657201343626d980b33925" ON "payments" ("organizationId") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_eca6657201343626d980b33925"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "organizationId"`);
  }
}
