import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKeycloakUserIdToUsers1790534444983 implements MigrationInterface {
  name = 'AddKeycloakUserIdToUsers1790534444983';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "keycloakUserId" character varying(64)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "keycloakUserId"`);
  }
}
