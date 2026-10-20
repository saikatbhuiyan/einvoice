import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The fixed id of the organization every pre-tenancy record is moved into. Hard-coded rather than
 * imported (migrations avoid @libs/* aliases -- see data-source.ts); the other apps' backfills use
 * the same literal (DEFAULT_ORGANIZATION_ID in @libs/shared/types).
 */
const DEFAULT_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Tenancy: organizations, and memberships (user x organization x role) replacing users.roleId.
 *
 * Hand-ordered from `user-access:migration:generate`'s output, which dropped users.roleId before
 * anything had copied it -- every existing user would have lost their role. Constraint/index names
 * are the generated ones, so the schema matches the entities exactly (the drift check).
 *
 * Data: one default organization; every existing user becomes a member of it with the role and
 * active flag they had.
 */
export class AddOrganizationsAndMemberships1792428875860 implements MigrationInterface {
  name = 'AddOrganizationsAndMemberships1792428875860';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Resolving a caller's organizations is a lookup by keycloakUserId, so it must be unique.
    // Duplicates would mean two local users claiming one Keycloak identity -- a human decision.
    const duplicates: Array<{ keycloakUserId: string }> = await queryRunner.query(
      `SELECT "keycloakUserId" FROM "users" WHERE "keycloakUserId" IS NOT NULL GROUP BY "keycloakUserId" HAVING COUNT(*) > 1`,
    );
    if (duplicates.length > 0) {
      throw new Error(
        `Cannot add tenancy: these Keycloak identities are linked to more than one user: ` +
          `${duplicates.map((row) => row.keycloakUserId).join(', ')}. Merge or unlink them, then re-run.`,
      );
    }

    await queryRunner.query(
      `CREATE TABLE "organizations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(160) NOT NULL, "slug" character varying(63) NOT NULL, "invoicePrefix" character varying(10) NOT NULL DEFAULT 'INV', "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6b031fcd0863e3f6b44230163f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_963693341bd612aa01ddf3a4b6" ON "organizations" ("slug") `);
    await queryRunner.query(
      `INSERT INTO "organizations" ("id", "name", "slug") VALUES ($1, 'Default organization', 'default')`,
      [DEFAULT_ORGANIZATION_ID],
    );

    await queryRunner.query(
      `CREATE TABLE "memberships" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "organizationId" uuid NOT NULL, "roleId" uuid NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_25d28bd932097a9e90495ede7b4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_98d23786d647f0ccf477b3b286" ON "memberships" ("organizationId") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_64893eb3c6fcaeaaee71a4d0ae" ON "memberships" ("userId", "organizationId") `,
    );

    // Copy every user's role into a membership of the default organization *before* the column goes.
    await queryRunner.query(
      `INSERT INTO "memberships" ("userId", "organizationId", "roleId", "isActive")
       SELECT "id", $1, "roleId", "isActive" FROM "users"`,
      [DEFAULT_ORGANIZATION_ID],
    );

    await queryRunner.query(
      `ALTER TABLE "memberships" ADD CONSTRAINT "FK_187d573e43b2c2aa3960df20b78" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "memberships" ADD CONSTRAINT "FK_98d23786d647f0ccf477b3b2867" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "memberships" ADD CONSTRAINT "FK_1564421aeb8beb517219b10d1a7" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_368e146b785b574f42ae9e53d5e"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "roleId"`);
    await queryRunner.query(`ALTER TABLE "roles" ADD "scope" character varying(16) NOT NULL DEFAULT 'organization'`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_46a53e00874b2750d37bb8d7ac" ON "users" ("keycloakUserId") `);
  }

  /**
   * Restores users.roleId from each user's membership -- the default organization's if they have
   * one, otherwise their oldest. A user with no membership at all has no role to restore, so the
   * revert refuses (naming them) rather than inventing one.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const roleless: Array<{ id: string }> = await queryRunner.query(
      `SELECT "u"."id" FROM "users" "u" WHERE NOT EXISTS (SELECT 1 FROM "memberships" "m" WHERE "m"."userId" = "u"."id")`,
    );
    if (roleless.length > 0) {
      throw new Error(
        `Cannot revert tenancy: these users have no membership to take a role from: ${roleless.map((row) => row.id).join(', ')}.`,
      );
    }

    await queryRunner.query(`DROP INDEX "public"."IDX_46a53e00874b2750d37bb8d7ac"`);
    await queryRunner.query(`ALTER TABLE "roles" DROP COLUMN "scope"`);
    await queryRunner.query(`ALTER TABLE "users" ADD "roleId" uuid`);
    await queryRunner.query(
      `UPDATE "users" "u" SET "roleId" = (
         SELECT "m"."roleId" FROM "memberships" "m" WHERE "m"."userId" = "u"."id"
         ORDER BY ("m"."organizationId" = $1) DESC, "m"."createdAt" ASC LIMIT 1
       )`,
      [DEFAULT_ORGANIZATION_ID],
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "roleId" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_368e146b785b574f42ae9e53d5e" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`ALTER TABLE "memberships" DROP CONSTRAINT "FK_1564421aeb8beb517219b10d1a7"`);
    await queryRunner.query(`ALTER TABLE "memberships" DROP CONSTRAINT "FK_98d23786d647f0ccf477b3b2867"`);
    await queryRunner.query(`ALTER TABLE "memberships" DROP CONSTRAINT "FK_187d573e43b2c2aa3960df20b78"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_64893eb3c6fcaeaaee71a4d0ae"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_98d23786d647f0ccf477b3b286"`);
    await queryRunner.query(`DROP TABLE "memberships"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_963693341bd612aa01ddf3a4b6"`);
    await queryRunner.query(`DROP TABLE "organizations"`);
  }
}
