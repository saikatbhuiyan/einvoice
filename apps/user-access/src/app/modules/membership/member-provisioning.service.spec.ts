import { ConflictException, Logger, UnprocessableEntityException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { KeycloakAdminService } from '@libs/auth/keycloak-admin.service';
import { MemberProvisioningService } from './member-provisioning.service';
import { MembershipDirectory } from './membership-directory';
import { RoleService } from '../role/role.service';
import { MembershipEntity } from '../../../database/entities/membership.entity';

const ORG = 'org-1';
const NEW_MEMBER = { email: 'jane@acme.test', name: 'Jane van Doe', roleId: 'role-1' };
const created = { id: 'membership-1', userId: 'user-1' } as MembershipEntity;

describe('MemberProvisioningService', () => {
  let directory: jest.Mocked<
    Pick<MembershipDirectory, 'findPersonByEmail' | 'findMembership' | 'addMembership' | 'createPersonWithMembership'>
  >;
  let roles: jest.Mocked<Pick<RoleService, 'getAssignableOrThrow'>>;
  let keycloak: jest.Mocked<Pick<KeycloakAdminService, 'findUserIdByUsername' | 'createUser' | 'deleteUser'>>;
  let service: MemberProvisioningService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    directory = {
      findPersonByEmail: jest.fn().mockResolvedValue(null),
      findMembership: jest.fn().mockResolvedValue(null),
      addMembership: jest.fn().mockResolvedValue(created),
      createPersonWithMembership: jest.fn().mockResolvedValue(created),
    };
    roles = { getAssignableOrThrow: jest.fn().mockResolvedValue({ id: 'role-1' }) };
    keycloak = {
      findUserIdByUsername: jest.fn().mockResolvedValue(null),
      createUser: jest.fn().mockResolvedValue('kc-new'),
      deleteUser: jest.fn().mockResolvedValue(undefined),
    };
    service = new MemberProvisioningService(directory as never, roles as never, keycloak as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('refuses an unassignable role before touching anything', async () => {
    roles.getAssignableOrThrow.mockRejectedValue(new UnprocessableEntityException('platform role'));

    await expect(service.addMember(ORG, NEW_MEMBER)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(directory.findPersonByEmail).not.toHaveBeenCalled();
    expect(keycloak.createUser).not.toHaveBeenCalled();
  });

  // One person, one Keycloak identity, many organizations.
  it('adds a membership for someone who already exists, without a new Keycloak identity', async () => {
    directory.findPersonByEmail.mockResolvedValue({ id: 'user-9' } as never);

    await expect(service.addMember(ORG, NEW_MEMBER)).resolves.toBe(created);

    expect(directory.addMembership).toHaveBeenCalledWith('user-9', ORG, 'role-1');
    expect(keycloak.createUser).not.toHaveBeenCalled();
  });

  it('refuses to add someone who is already a member of this organization', async () => {
    directory.findPersonByEmail.mockResolvedValue({ id: 'user-9' } as never);
    directory.findMembership.mockResolvedValue({ id: 'existing' } as never);

    await expect(service.addMember(ORG, NEW_MEMBER)).rejects.toBeInstanceOf(ConflictException);
    expect(directory.addMembership).not.toHaveBeenCalled();
  });

  it('links an existing Keycloak identity instead of creating a duplicate', async () => {
    keycloak.findUserIdByUsername.mockResolvedValue('kc-existing');

    await service.addMember(ORG, NEW_MEMBER);

    expect(keycloak.createUser).not.toHaveBeenCalled();
    expect(directory.createPersonWithMembership).toHaveBeenCalledWith(
      { email: 'jane@acme.test', name: 'Jane van Doe', keycloakUserId: 'kc-existing' },
      ORG,
      'role-1',
    );
  });

  it('creates a Keycloak identity for someone new, splitting the name', async () => {
    await service.addMember(ORG, NEW_MEMBER);

    expect(keycloak.createUser).toHaveBeenCalledWith({
      username: 'jane@acme.test',
      email: 'jane@acme.test',
      firstName: 'Jane',
      lastName: 'van Doe',
    });
    expect(directory.createPersonWithMembership).toHaveBeenCalledWith(
      expect.objectContaining({ keycloakUserId: 'kc-new' }),
      ORG,
      'role-1',
    );
  });

  it('deletes the identity it created when the local write fails', async () => {
    directory.createPersonWithMembership.mockRejectedValue(new Error('db down'));

    await expect(service.addMember(ORG, NEW_MEMBER)).rejects.toThrow('db down');
    expect(keycloak.deleteUser).toHaveBeenCalledWith('kc-new');
  });

  // It belongs to someone already -- deleting it would lock them out.
  it('never deletes a pre-existing identity it only linked', async () => {
    keycloak.findUserIdByUsername.mockResolvedValue('kc-existing');
    directory.createPersonWithMembership.mockRejectedValue(new Error('db down'));

    await expect(service.addMember(ORG, NEW_MEMBER)).rejects.toThrow('db down');
    expect(keycloak.deleteUser).not.toHaveBeenCalled();
  });

  it('turns a concurrent duplicate into a 409', async () => {
    const duplicate = Object.assign(new QueryFailedError('INSERT', [], new Error('dup')), {
      driverError: { code: '23505' },
    });
    directory.createPersonWithMembership.mockRejectedValue(duplicate);

    await expect(service.addMember(ORG, NEW_MEMBER)).rejects.toBeInstanceOf(ConflictException);
  });
});
