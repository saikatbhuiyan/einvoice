import { MigrationInterface, QueryRunner } from 'typeorm';

/** Unit of supply, a Mushak-6.3 column. Nullable: existing products have none until edited. */
export class AddUnitToProducts1792640100000 implements MigrationInterface {
  name = 'AddUnitToProducts1792640100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD "unit" character varying(16)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "unit"`);
  }
}
