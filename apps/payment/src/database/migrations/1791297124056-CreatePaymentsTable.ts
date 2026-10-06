import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentsTable1791297124056 implements MigrationInterface {
  name = 'CreatePaymentsTable1791297124056';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid_generate_v4() (used as the id column default below) is provided by this
    // extension, not Postgres core -- migration:generate doesn't add this statement
    // automatically, but a fresh database won't have it enabled yet (same gotcha as
    // apps/product's initial migration).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "invoiceId" character varying(64) NOT NULL, "provider" character varying(32) NOT NULL DEFAULT 'stripe', "providerSessionId" character varying(255) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "amount" numeric(14,2) NOT NULL, "currency" character varying(3) NOT NULL, "checkoutUrl" character varying(2048), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_43d19956aeab008b49e0804c14" ON "payments" ("invoiceId") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_5453c0ab187dbeb87694058623" ON "payments" ("providerSessionId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_5453c0ab187dbeb87694058623"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_43d19956aeab008b49e0804c14"`);
    await queryRunner.query(`DROP TABLE "payments"`);
  }
}
