import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Each organization's payment reminder schedule (days after the due date). Existing organizations
 * get the default, 1/7/14 days: safe on rollout, because the scheduler never sends a reminder more
 * than 24 h after it was due, so invoices that were already long overdue don't trigger a burst of
 * emails. As generated: NOT NULL with a default fills existing rows, no data step needed.
 */
export class AddReminderScheduleToOrganizations1792490319179 implements MigrationInterface {
  name = 'AddReminderScheduleToOrganizations1792490319179';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD "reminderOffsetsDays" integer array NOT NULL DEFAULT '{1,7,14}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "reminderOffsetsDays"`);
  }
}
