import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widens payments.status to fit 'reconciliation_required' (23 chars, past the original 16).
 *
 * Hand-corrected from `payment:migration:generate`'s output, which emitted DROP COLUMN + ADD
 * COLUMN for this length change -- that would have reset every existing row's status to the
 * column default ('pending'), silently turning already-paid payments back into unpaid ones.
 * ALTER COLUMN ... TYPE keeps the data.
 *
 * `down` narrows back to 16 with no data rewriting: if any row is 'reconciliation_required',
 * Postgres refuses the narrowing outright (value too long) rather than truncating it -- a loud
 * failure is the correct outcome there, since those rows need a human decision before the old
 * schema can represent them, not an automatic one.
 */
export class WidenPaymentStatusColumn1791341354990 implements MigrationInterface {
  name = 'WidenPaymentStatusColumn1791341354990';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "status" TYPE character varying(32)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "status" TYPE character varying(16)`);
  }
}
