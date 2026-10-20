import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Saga, SagaExecutionError } from '@libs/saga';
import { KeycloakAdminService } from '@libs/auth/keycloak-admin.service';
import { MembershipEntity } from '../../../database/entities/membership.entity';
import { RoleService } from '../role/role.service';
import { MembershipDirectory } from './membership-directory';

export interface NewMember {
  email: string;
  name: string;
  roleId: string;
}

interface ProvisionSagaContext {
  member: NewMember;
  organizationId: string;
  keycloakUserId?: string;
  createdInKeycloak: boolean;
  membership?: MembershipEntity;
}

const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * The one way a person joins an organization (POST /users, and an organization's first admin):
 *
 * - someone already known here (a member elsewhere) just gains a membership -- one person, one
 *   Keycloak identity, many organizations;
 * - someone with a Keycloak identity but no local record (created in the console, the dev realm's
 *   users) is linked to it;
 * - anyone else gets a new Keycloak identity, and if the local write then fails, that identity is
 *   deleted again (saga compensation) -- but never one this call didn't create.
 */
@Injectable()
export class MemberProvisioningService {
  private readonly logger = new Logger(MemberProvisioningService.name);

  constructor(
    private readonly directory: MembershipDirectory,
    private readonly roleService: RoleService,
    private readonly keycloakAdmin: KeycloakAdminService,
  ) {}

  async addMember(organizationId: string, member: NewMember): Promise<MembershipEntity> {
    await this.roleService.getAssignableOrThrow(member.roleId);

    const person = await this.directory.findPersonByEmail(member.email);
    if (person) {
      if (await this.directory.findMembership(person.id, organizationId)) {
        throw new ConflictException(`"${member.email}" is already a member of this organization.`);
      }
      return this.persist(() => this.directory.addMembership(person.id, organizationId, member.roleId), member.email);
    }

    const context: ProvisionSagaContext = { member, organizationId, createdInKeycloak: false };
    const saga = new Saga<ProvisionSagaContext>('ProvisionMember')
      .addStep({
        name: 'resolveKeycloakIdentity',
        execute: async (ctx) => {
          const existing = await this.keycloakAdmin.findUserIdByUsername(ctx.member.email);
          if (existing) {
            ctx.keycloakUserId = existing;
            return;
          }
          const [firstName, ...rest] = ctx.member.name.trim().split(/\s+/);
          ctx.keycloakUserId = await this.keycloakAdmin.createUser({
            username: ctx.member.email,
            email: ctx.member.email,
            firstName,
            lastName: rest.length > 0 ? rest.join(' ') : undefined,
          });
          ctx.createdInKeycloak = true;
        },
        // Only undo what this call did: a pre-existing identity belongs to someone already.
        compensate: async (ctx) => {
          if (ctx.createdInKeycloak) await this.keycloakAdmin.deleteUser(ctx.keycloakUserId as string);
        },
      })
      .addStep({
        name: 'persistPersonAndMembership',
        execute: async (ctx) => {
          ctx.membership = await this.directory.createPersonWithMembership(
            { email: ctx.member.email, name: ctx.member.name, keycloakUserId: ctx.keycloakUserId as string },
            ctx.organizationId,
            ctx.member.roleId,
          );
        },
      });

    try {
      await saga.execute(context);
    } catch (error) {
      if (error instanceof SagaExecutionError) this.rethrowPersistenceError(error.cause, member.email);
      throw error;
    }
    return context.membership as MembershipEntity;
  }

  private async persist(write: () => Promise<MembershipEntity>, email: string): Promise<MembershipEntity> {
    try {
      return await write();
    } catch (error) {
      this.rethrowPersistenceError(error, email);
    }
  }

  // A concurrent request added the same person (or membership) first.
  private rethrowPersistenceError(error: unknown, email: string): never {
    if (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string })?.code === POSTGRES_UNIQUE_VIOLATION
    ) {
      throw new ConflictException(`"${email}" was just added by another request; retry to see it.`);
    }
    this.logger.error(
      `Failed to add "${email}" to an organization`,
      error instanceof Error ? error.stack : String(error),
    );
    throw error;
  }
}
