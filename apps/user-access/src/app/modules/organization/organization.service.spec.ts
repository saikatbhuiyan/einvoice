import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { OrganizationService } from './organization.service';
import { OrganizationEntity } from '../../../database/entities/organization.entity';

const REQUEST = { name: 'Acme Ltd.', slug: 'acme', admin: { email: 'owner@acme.test', name: 'Olive Owner' } };

describe('OrganizationService', () => {
  let organizations: { save: jest.Mock; create: jest.Mock; delete: jest.Mock; findOne: jest.Mock };
  let provisioning: { addMember: jest.Mock };
  let roles: { getByNameOrThrow: jest.Mock };
  let service: OrganizationService;

  beforeEach(() => {
    organizations = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({
        id: 'org-1',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      })),
      delete: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
    };
    provisioning = { addMember: jest.fn().mockResolvedValue({}) };
    roles = { getByNameOrThrow: jest.fn().mockResolvedValue({ id: 'admin-role' }) };
    service = new OrganizationService(organizations as never, provisioning as never, roles as never);
  });

  it('creates the organization with its first administrator, defaulting the invoice prefix', async () => {
    const result = await service.create(REQUEST);

    expect(organizations.create).toHaveBeenCalledWith({ name: 'Acme Ltd.', slug: 'acme', invoicePrefix: 'INV' });
    expect(provisioning.addMember).toHaveBeenCalledWith('org-1', {
      email: 'owner@acme.test',
      name: 'Olive Owner',
      roleId: 'admin-role',
    });
    expect(result).toMatchObject({ id: 'org-1', slug: 'acme', invoicePrefix: 'INV' });
  });

  // A tenant nobody can manage is worse than no tenant.
  it('deletes the new organization again if its first administrator cannot be added', async () => {
    provisioning.addMember.mockRejectedValue(new Error('Keycloak down'));

    await expect(service.create(REQUEST)).rejects.toThrow('Keycloak down');
    expect(organizations.delete).toHaveBeenCalledWith({ id: 'org-1' });
  });

  it('turns a taken slug into a 409 and creates no administrator', async () => {
    organizations.save.mockRejectedValue(
      Object.assign(new QueryFailedError('INSERT', [], new Error('dup')), { driverError: { code: '23505' } }),
    );

    await expect(service.create(REQUEST)).rejects.toBeInstanceOf(ConflictException);
    expect(provisioning.addMember).not.toHaveBeenCalled();
  });

  it('is a 404 for an unknown organization', async () => {
    organizations.findOne.mockResolvedValue(null);

    await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps an organization to its response', async () => {
    organizations.findOne.mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      invoicePrefix: 'ACME',
      isActive: true,
      createdAt: new Date('2026-10-19'),
      updatedAt: new Date('2026-10-19'),
    } as OrganizationEntity);

    await expect(service.findOne('org-1')).resolves.toMatchObject({ id: 'org-1', invoicePrefix: 'ACME' });
  });

  it("returns only an organization's invoice settings to invoice", async () => {
    organizations.findOne.mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      invoicePrefix: 'ACME',
    } as OrganizationEntity);

    await expect(service.invoiceSettings('org-1')).resolves.toEqual({ invoicePrefix: 'ACME' });
  });
});
