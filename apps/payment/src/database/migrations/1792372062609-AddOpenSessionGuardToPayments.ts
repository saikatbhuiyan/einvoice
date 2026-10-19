import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `expiresAt` (when the Stripe session stops accepting payment) and a partial unique index
 * allowing at most one pending (open) checkout session per invoice.
 *
 * Existing rows keep `expiresAt` null: PaymentService treats a pending row with no expiry as not
 * reusable and retires it (expires it at Stripe) the next time a payment link is requested.
 *
 * If an invoice already has more than one pending row, the index can't be built. Each of those
 * rows is a Stripe session a customer may still be able to pay, so picking which to keep is a
 * human decision -- `up` refuses with the offending invoice ids rather than silently failing on
 * the index or changing any status itself (same stance as WidenPaymentStatusColumn's `down`).
 */
export class AddOpenSessionGuardToPayments1792372062609 implements MigrationInterface {
  name = 'AddOpenSessionGuardToPayments1792372062609';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicates: Array<{ invoiceId: string }> = await queryRunner.query(
      `SELECT "invoiceId" FROM "payments" WHERE "status" = 'pending' GROUP BY "invoiceId" HAVING COUNT(*) > 1`,
    );
    if (duplicates.length > 0) {
      throw new Error(
        `Cannot add the one-open-session-per-invoice index: these invoices have more than one pending payment: ` +
          `${duplicates.map((row) => row.invoiceId).join(', ')}. Expire all but one of each at Stripe and mark ` +
          `those rows 'failed', then re-run the migration.`,
      );
    }

    await queryRunner.query(`ALTER TABLE "payments" ADD "expiresAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_payments_open_session_per_invoice" ON "payments" ("invoiceId") WHERE "status" = 'pending'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_payments_open_session_per_invoice"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "expiresAt"`);
  }
}
