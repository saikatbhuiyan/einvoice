import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The organization every pre-tenancy product is moved into -- the same fixed id user-access's
 * AddOrganizationsAndMemberships migration creates (DEFAULT_ORGANIZATION_ID in @libs/shared/types;
 * a literal here because migrations avoid @libs/* aliases, see data-source.ts).
 */
const DEFAULT_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Tenancy: products belong to an organization, and a SKU is unique per organization.
 *
 * Hand-edited from `product:migration:generate`, which added the column as NOT NULL in one step --
 * that fails on any table that already has products. Added nullable, backfilled, then constrained.
 * Index names are the generated ones, so the schema matches the entity (the drift check).
 */
export class AddOrganizationToProducts1792431483786 implements MigrationInterface {
  name = 'AddOrganizationToProducts1792431483786';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD "organizationId" uuid`);
    await queryRunner.query(`UPDATE "products" SET "organizationId" = $1`, [DEFAULT_ORGANIZATION_ID]);
    await queryRunner.query(`ALTER TABLE "products" ALTER COLUMN "organizationId" SET NOT NULL`);

    await queryRunner.query(`DROP INDEX "public"."IDX_c44ac33a05b144dd0d9ddcf932"`);
    await queryRunner.query(`CREATE INDEX "IDX_746c8057201c260fe77b5e7f61" ON "products" ("organizationId") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ec69270b0e2426173c0ec4b73c" ON "products" ("organizationId", "sku") `,
    );
  }

  /**
   * Back to one global catalog. Refuses (naming them) if two organizations use the same SKU: the
   * global unique index can't be restored without a human choosing which product keeps it.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const shared: Array<{ sku: string }> = await queryRunner.query(
      `SELECT "sku" FROM "products" GROUP BY "sku" HAVING COUNT(*) > 1`,
    );
    if (shared.length > 0) {
      throw new Error(
        `Cannot revert product tenancy: these SKUs exist in more than one organization: ${shared
          .map((row) => row.sku)
          .join(', ')}.`,
      );
    }

    await queryRunner.query(`DROP INDEX "public"."IDX_ec69270b0e2426173c0ec4b73c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_746c8057201c260fe77b5e7f61"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "organizationId"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c44ac33a05b144dd0d9ddcf932" ON "products" ("sku") `);
  }
}
