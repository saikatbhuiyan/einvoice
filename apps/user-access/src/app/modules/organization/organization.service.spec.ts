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

  it("returns only an organization's invoicing settings and issuer identity to invoice", async () => {
    organizations.findOne.mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      invoicePrefix: 'ACME',
      reminderOffsetsDays: [1, 7],
      bin: '0012345670101',
      address: 'House 12, Road 8, Dhaka',
      timeZone: 'Asia/Dhaka',
      signatoryName: 'Rahim Uddin',
      signatoryDesignation: 'Accounts Manager',
    } as OrganizationEntity);

    await expect(service.invoiceSettings('org-1')).resolves.toEqual({
      invoicePrefix: 'ACME',
      reminderOffsetsDays: [1, 7],
      timeZone: 'Asia/Dhaka',
      issuer: {
        name: 'Acme',
        bin: '0012345670101',
        address: 'House 12, Road 8, Dhaka',
        authorizedSignatory: { name: 'Rahim Uddin', designation: 'Accounts Manager' },
      },
    });
  });

  it('reports no signatory unless both name and designation are set', async () => {
    organizations.findOne.mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
      timeZone: 'UTC',
      signatoryName: 'Rahim Uddin',
      signatoryDesignation: null,
    } as OrganizationEntity);

    await expect(service.findOne('org-1')).resolves.toMatchObject({ authorizedSignatory: null, bin: null });
  });

  describe('updateSettings (an organization admin, via RPC: re-validated here)', () => {
    let update: jest.Mock;

    beforeEach(() => {
      organizations.findOne.mockResolvedValue({
        id: 'org-1',
        invoicePrefix: 'ACME',
        reminderOffsetsDays: [3],
        bin: null,
        address: null,
        timeZone: 'UTC',
      } as OrganizationEntity);
      update = jest.fn().mockResolvedValue(undefined);
      Object.assign(organizations, { update });
    });

    it('writes only name, prefix and schedule, whatever else the payload carries', async () => {
      await service.updateSettings('org-1', {
        name: '  Acme Ltd ',
        invoicePrefix: 'ACM',
        reminderOffsetsDays: [2, 9],
        slug: 'taken',
        isActive: false,
      } as never);

      expect(update).toHaveBeenCalledWith(
        { id: 'org-1' },
        { name: 'Acme Ltd', invoicePrefix: 'ACM', reminderOffsetsDays: [2, 9] },
      );
    });

    it('accepts an empty schedule (reminders off)', async () => {
      await service.updateSettings('org-1', { reminderOffsetsDays: [] });

      expect(update).toHaveBeenCalledWith({ id: 'org-1' }, { reminderOffsetsDays: [] });
    });

    it('sets a BIN with its address, and moves an organization still on UTC to Asia/Dhaka', async () => {
      await service.updateSettings('org-1', { bin: '0012345670101', address: ' House 12, Road 8, Dhaka ' });

      expect(update).toHaveBeenCalledWith(
        { id: 'org-1' },
        { bin: '0012345670101', address: 'House 12, Road 8, Dhaka', timeZone: 'Asia/Dhaka' },
      );
    });

    it('keeps a time zone given in the same request, or one already chosen', async () => {
      await service.updateSettings('org-1', {
        bin: '0012345670101',
        address: 'Road 8, Dhaka',
        timeZone: 'Asia/Kolkata',
      });
      expect(update).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ timeZone: 'Asia/Kolkata' }));

      organizations.findOne.mockResolvedValue({ id: 'org-1', bin: null, address: null, timeZone: 'Europe/London' });
      await service.updateSettings('org-1', { bin: '0012345670101', address: 'Road 8, Dhaka' });
      expect(update).toHaveBeenLastCalledWith(expect.anything(), { bin: '0012345670101', address: 'Road 8, Dhaka' });
    });

    it('sets and clears the authorised signatory', async () => {
      await service.updateSettings('org-1', { authorizedSignatory: { name: ' Rahim Uddin ', designation: 'Manager' } });
      expect(update).toHaveBeenLastCalledWith(
        { id: 'org-1' },
        { signatoryName: 'Rahim Uddin', signatoryDesignation: 'Manager' },
      );

      await service.updateSettings('org-1', { authorizedSignatory: null });
      expect(update).toHaveBeenLastCalledWith({ id: 'org-1' }, { signatoryName: null, signatoryDesignation: null });
    });

    // The seller block of a Mushak-6.3 is name, BIN and address together.
    it('refuses a BIN without an address, and removing the address of an organization with a BIN', async () => {
      await expect(service.updateSettings('org-1', { bin: '0012345670101' })).rejects.toThrow(/needs its address/);

      organizations.findOne.mockResolvedValue({
        id: 'org-1',
        bin: '0012345670101',
        address: 'Road 8',
        timeZone: 'Asia/Dhaka',
      });
      await expect(service.updateSettings('org-1', { address: null })).rejects.toThrow(/needs its address/);
      expect(update).not.toHaveBeenCalled();
    });

    it('clears a BIN', async () => {
      organizations.findOne.mockResolvedValue({
        id: 'org-1',
        bin: '0012345670101',
        address: 'Road 8',
        timeZone: 'Asia/Dhaka',
      });

      await service.updateSettings('org-1', { bin: null });

      expect(update).toHaveBeenCalledWith({ id: 'org-1' }, { bin: null });
    });

    it.each([
      [{ bin: '12345' }, /13 digits/],
      [{ bin: 12345 }, /13 digits/],
      [{ timeZone: 'Mars/Olympus' }, /not a known IANA/],
      [{ timeZone: '+06:00' }, /IANA time zone/],
      [{ address: 'abc' }, /5-300/],
      [{ authorizedSignatory: { name: 'Rahim' } }, /authorizedSignatory needs/],
      [{ reminderOffsetsDays: [7, 1] }, /ascending/],
      [{ reminderOffsetsDays: [0] }, /from 1 to 365/],
      [{ invoicePrefix: 'acme' }, /upper-case/],
      [{ name: 'A' }, /2-160/],
    ])('refuses %j with a 422', async (request, message) => {
      await expect(service.updateSettings('org-1', request as never)).rejects.toThrow(message);
      expect(update).not.toHaveBeenCalled();
    });
  });
});
