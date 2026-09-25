import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductsTable1790305267111 implements MigrationInterface {
  name = 'CreateProductsTable1790305267111';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid_generate_v4() (used as the id column default below) is provided by this
    // extension, not Postgres core -- migration:generate doesn't add this statement
    // automatically, but a fresh database won't have it enabled yet.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sku" character varying(64) NOT NULL, "name" character varying(160) NOT NULL, "description" character varying(1000), "unitPrice" numeric(14,2) NOT NULL, "currency" character varying(3) NOT NULL, "vatRate" numeric(5,2) NOT NULL DEFAULT '0', "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c44ac33a05b144dd0d9ddcf932" ON "products" ("sku") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_c44ac33a05b144dd0d9ddcf932"`);
    await queryRunner.query(`DROP TABLE "products"`);
  }
}
