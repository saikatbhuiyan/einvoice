import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The payments ledger: one row per money movement. Existing checkouts that collected money get
 * their entry here, so the ledger is complete from day one:
 * - paid -> applied (invoice already counts it: it was marked paid);
 * - reconciliation_required -> refused (money received that invoice never counted -- a refund is owed);
 * - review_required -> held (a high-risk payment waiting for a person to accept or refuse it -- without
 *   an entry, neither would be possible).
 * Neither has a provider reference (none was stored before the ledger), so refunding one means
 * returning the money in the provider's dashboard and recording it (returnedOutsideSystem).
 */
export class AddLedgerEntries1792691652640 implements MigrationInterface {
  name = 'AddLedgerEntries1792691652640';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ledger_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organizationId" uuid NOT NULL, "invoiceId" character varying(64) NOT NULL, "kind" character varying(16) NOT NULL, "method" character varying(32) NOT NULL, "amount" numeric(14,2) NOT NULL, "currency" character varying(3) NOT NULL, "state" character varying(16) NOT NULL, "applyState" character varying(16) NOT NULL, "paymentId" uuid, "refundOfEntryId" uuid, "providerReference" character varying(128), "reference" character varying(128), "note" character varying(500), "failureReason" character varying(500), "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "recordedBy" character varying(128), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6efcb84411d3f08b08450ae75d5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_d087129e276697b1a2bd6d8bc7" ON "ledger_entries" ("organizationId") `);
    await queryRunner.query(`CREATE INDEX "IDX_58f9b8a6f162afa26dd26d5aa7" ON "ledger_entries" ("invoiceId") `);
    await queryRunner.query(`CREATE INDEX "IDX_34f80a26d7261ff79ba2058af3" ON "ledger_entries" ("refundOfEntryId") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ledger_entries_payment_per_checkout" ON "ledger_entries" ("paymentId") WHERE "kind" = 'payment'`,
    );
    await queryRunner.query(
      `INSERT INTO "ledger_entries"
               ("organizationId", "invoiceId", "kind", "method", "amount", "currency", "state", "applyState", "paymentId", "occurredAt", "recordedBy")
             SELECT "organizationId", "invoiceId", 'payment', "provider", "amount", "currency", 'settled',
                    CASE "status" WHEN 'paid' THEN 'applied' WHEN 'review_required' THEN 'held' ELSE 'refused' END,
                    "id", "updatedAt", 'migration:AddLedgerEntries'
             FROM "payments"
             WHERE "status" IN ('paid', 'reconciliation_required', 'review_required')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_ledger_entries_payment_per_checkout"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_34f80a26d7261ff79ba2058af3"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_58f9b8a6f162afa26dd26d5aa7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d087129e276697b1a2bd6d8bc7"`);
    await queryRunner.query(`DROP TABLE "ledger_entries"`);
  }
}
