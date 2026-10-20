import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { runWithCorrelationContext } from '@libs/logging/correlation-context';
import type { KeycloakAdminService } from '@libs/auth/keycloak-admin.service';
import { UserService } from './user.service';
import { IUserRepository } from './user.repository.interface';
import { RoleService } from '../role/role.service';
import { MemberProvisioningService } from '../membership/member-provisioning.service';
import { MembershipDirectory } from '../membership/membership-directory';
import { MembershipEntity } from '../../../database/entities/membership.entity';
import { RoleEntity } from '../../../database/entities/role.entity';

const ORG = '6a1f1c2e-0b9d-4d55-9a8b-6b8f7c1d2e3f';

const role = (overrides: Partial<RoleEntity> = {}) =>
  ({
    id: 'role-1',
    name: 'accountant',
    description: 'desc',
    permissions: ['invoice:read'],
    scope: 'organization',
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }) as RoleEntity;

const member = (overrides: Partial<MembershipEntity> = {}, userOverrides: Record<string, unknown> = {}) =>
  ({
    id: 'membership-1',
    userId: 'user-1',
    organizationId: ORG,
    roleId: 'role-1',
    role: role(),
    isActive: true,
    createdAt: new Date('2026-02-01'),
    updatedAt: new Date('2026-02-01'),
    user: {
      id: 'user-1',
      email: 'jane@acme.test',
      name: 'Jane Doe',
      keycloakUserId: 'kc-1',
      isActive: true,
      ...userOverrides,
    },
    ...overrides,
  }) as MembershipEntity;

describe('UserService (members of the current organization)', () => {
  let repository: jest.Mocked<IUserRepository>;
  let roleService: jest.Mocked<Pick<RoleService, 'getAssignableOrThrow'>>;
  let provisioning: jest.Mocked<Pick<MemberProvisioningService, 'addMember'>>;
  let directory: jest.Mocked<Pick<MembershipDirectory, 'countActiveMemberships'>>;
  let keycloak: jest.Mocked<Pick<KeycloakAdminService, 'setEnabled'>>;
  let service: UserService;

  const inOrg = <T>(work: () => Promise<T>) =>
    runWithCorrelationContext({ correlationId: 'c', traceId: 't', organizationId: ORG }, work);

  beforeEach(() => {
    repository = { findMembers: jest.fn(), findMember: jest.fn(), updateMember: jest.fn() };
    roleService = { getAssignableOrThrow: jest.fn().mockResolvedValue(role()) };
    provisioning = { addMember: jest.fn() };
    directory = { countActiveMemberships: jest.fn().mockResolvedValue(0) };
    keycloak = { setEnabled: jest.fn().mockResolvedValue(undefined) };
    service = new UserService(
      repository,
      roleService as never,
      provisioning as never,
      directory as never,
      keycloak as never,
    );
  });

  it('adds the person to the current organization and returns them as a member', async () => {
    provisioning.addMember.mockResolvedValue(member());
    repository.findMember.mockResolvedValue(member());

    const result = await inOrg(() => service.create({ email: 'jane@acme.test', name: 'Jane Doe', roleId: 'role-1' }));

    expect(provisioning.addMember).toHaveBeenCalledWith(ORG, {
      email: 'jane@acme.test',
      name: 'Jane Doe',
      roleId: 'role-1',
    });
    expect(result).toMatchObject({
      id: 'user-1',
      email: 'jane@acme.test',
      role: { name: 'accountant', scope: 'organization' },
    });
  });

  it('refuses to create a member without an organization in context', async () => {
    await expect(service.create({ email: 'x@y.test', name: 'X', roleId: 'role-1' })).rejects.toThrow(
      /No organization in the request context/,
    );
    expect(provisioning.addMember).not.toHaveBeenCalled();
  });

  it('reports a member as inactive when either the membership or the person is', async () => {
    repository.findMember
      .mockResolvedValueOnce(member({ isActive: false }))
      .mockResolvedValueOnce(member({}, { isActive: false }));

    expect((await inOrg(() => service.findOne('user-1'))).isActive).toBe(false);
    expect((await inOrg(() => service.findOne('user-1'))).isActive).toBe(false);
  });

  // A person who belongs to another organization only is "not found" here.
  it('treats someone who is not a member of this organization as not found', async () => {
    repository.findMember.mockResolvedValue(null);

    await expect(inOrg(() => service.findOne('user-1'))).rejects.toBeInstanceOf(NotFoundException);
    await expect(inOrg(() => service.update('user-1', { name: 'x' }))).rejects.toBeInstanceOf(NotFoundException);
    await expect(inOrg(() => service.deactivate('user-1'))).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.updateMember).not.toHaveBeenCalled();
  });

  it('changes the role in this organization only after checking the role may be assigned', async () => {
    repository.findMember.mockResolvedValue(member());
    repository.updateMember.mockResolvedValue(
      member({ roleId: 'role-2', role: role({ id: 'role-2', name: 'viewer' }) }),
    );

    const result = await inOrg(() => service.update('user-1', { roleId: 'role-2', name: 'Jane D.' }));

    expect(roleService.getAssignableOrThrow).toHaveBeenCalledWith('role-2');
    expect(repository.updateMember).toHaveBeenCalledWith('user-1', {
      name: 'Jane D.',
      roleId: 'role-2',
      isActive: undefined,
    });
    expect(result.role.name).toBe('viewer');
  });

  it('refuses to assign a platform role through an organization', async () => {
    repository.findMember.mockResolvedValue(member());
    roleService.getAssignableOrThrow.mockRejectedValue(new UnprocessableEntityException('nope'));

    await expect(inOrg(() => service.update('user-1', { roleId: 'platform-role' }))).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(repository.updateMember).not.toHaveBeenCalled();
  });

  describe('deactivate', () => {
    beforeEach(() => repository.findMember.mockResolvedValue(member()));

    it('ends the membership, and disables the Keycloak account once no active membership is left', async () => {
      directory.countActiveMemberships.mockResolvedValue(0);

      await expect(inOrg(() => service.deactivate('user-1'))).resolves.toEqual({ id: 'user-1', deactivated: true });

      expect(repository.updateMember).toHaveBeenCalledWith('user-1', { isActive: false });
      expect(keycloak.setEnabled).toHaveBeenCalledWith('kc-1', false);
    });

    // Otherwise one organization could lock a person out of another.
    it('keeps the Keycloak account enabled while the person is active elsewhere', async () => {
      directory.countActiveMemberships.mockResolvedValue(1);

      await inOrg(() => service.deactivate('user-1'));

      expect(keycloak.setEnabled).not.toHaveBeenCalled();
    });
  });
});
