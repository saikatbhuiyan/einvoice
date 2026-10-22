import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a Mushak-6.3 tax invoice says about its issuer: BIN, challan-issuing address, the
 * officer-in-charge, and the time zone dates of issue are written in. Existing organizations get
 * none of them and keep UTC, so their invoices and numbering behave exactly as before until an
 * admin sets them.
 */
export class AddTaxIdentityToOrganizations1792640000000 implements MigrationInterface {
  name = 'AddTaxIdentityToOrganizations1792640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organizations" ADD "bin" character varying(13)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD "address" character varying(300)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD "timeZone" character varying(64) NOT NULL DEFAULT 'UTC'`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD "signatoryName" character varying(120)`);
    await queryRunner.query(`ALTER TABLE "organizations" ADD "signatoryDesignation" character varying(80)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "signatoryDesignation"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "signatoryName"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "timeZone"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "address"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "bin"`);
  }
}
