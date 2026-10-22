import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bangladesh supplementary duty per product (percent). Existing products get 0, which leaves their
 * invoices' arithmetic unchanged (VAT on net + 0). NOT NULL with a default fills existing rows.
 */
export class AddSdRateToProducts1792577019000 implements MigrationInterface {
  name = 'AddSdRateToProducts1792577019000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD "sdRate" numeric(5,2) NOT NULL DEFAULT '0'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "sdRate"`);
  }
}
