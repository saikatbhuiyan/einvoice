import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Saga, SagaExecutionError } from '@libs/saga';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import {
  BANGLADESH_TIME_ZONE,
  DEFAULT_TIME_ZONE,
  TAX_IDENTITY_CONSTRAINTS,
  binProblem,
  buildPaginationMeta,
  reminderScheduleProblem,
  signatoryProblem,
  timeZoneProblem,
} from '@libs/shared/types';
import { containsPattern } from '@libs/shared/utils';
import {
  CreateOrganizationRequest,
  FindAllOrganizationsRequest,
  FindAllOrganizationsResponse,
  OrganizationInvoiceSettings,
  OrganizationResponse,
  UpdateCurrentOrganizationRequest,
} from '@libs/interfaces/gateway';
import { OrganizationEntity } from '../../../database/entities/organization.entity';
import { RoleService } from '../role/role.service';
import { MemberProvisioningService } from '../membership/member-provisioning.service';

const POSTGRES_UNIQUE_VIOLATION = '23505';
const FIRST_ADMIN_ROLE = 'admin';

interface CreateOrganizationSagaContext {
  request: CreateOrganizationRequest;
  organization?: OrganizationEntity;
}

/**
 * Platform operations (platform:admin): organizations are created *with* their first administrator,
 * so a new tenant is never left with nobody able to manage it.
 */
@Injectable()
export class OrganizationService {
  constructor(
    @InjectRepository(OrganizationEntity) private readonly organizations: Repository<OrganizationEntity>,
    private readonly provisioning: MemberProvisioningService,
    private readonly roleService: RoleService,
  ) {}

  async create(request: CreateOrganizationRequest): Promise<OrganizationResponse> {
    const adminRole = await this.roleService.getByNameOrThrow(FIRST_ADMIN_ROLE);
    const context: CreateOrganizationSagaContext = { request };

    const saga = new Saga<CreateOrganizationSagaContext>('CreateOrganization')
      .addStep({
        name: 'createOrganization',
        execute: async (ctx) => {
          ctx.organization = await this.organizations.save(
            this.organizations.create({
              name: ctx.request.name,
              slug: ctx.request.slug,
              invoicePrefix: ctx.request.invoicePrefix ?? 'INV',
            }),
          );
        },
        // No membership exists yet if the next step failed, so the RESTRICT foreign key allows this.
        compensate: async (ctx) => {
          await this.organizations.delete({ id: ctx.organization?.id });
        },
      })
      .addStep({
        name: 'addFirstAdmin',
        execute: async (ctx) => {
          await this.provisioning.addMember(ctx.organization?.id as string, {
            email: ctx.request.admin.email,
            name: ctx.request.admin.name,
            roleId: adminRole.id,
          });
        },
      });

    try {
      await saga.execute(context);
    } catch (error) {
      if (error instanceof SagaExecutionError) {
        const cause = error.cause;
        if (
          cause instanceof QueryFailedError &&
          (cause.driverError as { code?: string })?.code === POSTGRES_UNIQUE_VIOLATION
        ) {
          throw new ConflictException(`An organization with slug "${request.slug}" already exists.`);
        }
        throw cause;
      }
      throw error;
    }

    return this.toResponse(context.organization as OrganizationEntity);
  }

  async findAll(query: FindAllOrganizationsRequest): Promise<FindAllOrganizationsResponse> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const qb = this.organizations.createQueryBuilder('organization');
    if (query.search) {
      qb.where('(organization.name ILIKE :search OR organization.slug ILIKE :search)', {
        search: containsPattern(query.search),
      });
    }
    const [items, total] = await qb
      .orderBy('organization.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items: items.map((item) => this.toResponse(item)), meta: buildPaginationMeta(page, limit, total) };
  }

  async findOne(id: string): Promise<OrganizationResponse> {
    const organization = await this.organizations.findOne({ where: { id } });
    if (!organization) {
      throw new NotFoundException(`Organization not found for id "${id}".`);
    }
    return this.toResponse(organization);
  }

  async invoiceSettings(id: string): Promise<OrganizationInvoiceSettings> {
    const { invoicePrefix, reminderOffsetsDays, timeZone, name, bin, address, authorizedSignatory } =
      await this.findOne(id);
    return { invoicePrefix, reminderOffsetsDays, timeZone, issuer: { name, bin, address, authorizedSignatory } };
  }

  /**
   * An organization's admin changing its own settings. Re-validated here: RPC payloads skip the
   * gateway's DTO validation, and only the fields below can ever be written this way.
   */
  async updateSettings(id: string, request: UpdateCurrentOrganizationRequest): Promise<OrganizationResponse> {
    const current = await this.organizations.findOne({ where: { id } });
    if (!current) {
      throw new NotFoundException(`Organization not found for id "${id}".`);
    }
    const changes: Partial<
      Pick<
        OrganizationEntity,
        | 'name'
        | 'invoicePrefix'
        | 'reminderOffsetsDays'
        | 'bin'
        | 'address'
        | 'timeZone'
        | 'signatoryName'
        | 'signatoryDesignation'
      >
    > = {};
    if (request.name !== undefined) {
      if (typeof request.name !== 'string' || request.name.trim().length < 2 || request.name.length > 160) {
        throw new UnprocessableEntityException('name must be 2-160 characters.');
      }
      changes.name = request.name.trim();
    }
    if (request.invoicePrefix !== undefined) {
      if (typeof request.invoicePrefix !== 'string' || !/^[A-Z0-9]{1,10}$/.test(request.invoicePrefix)) {
        throw new UnprocessableEntityException('invoicePrefix must be 1-10 upper-case letters or digits.');
      }
      changes.invoicePrefix = request.invoicePrefix;
    }
    if (request.reminderOffsetsDays !== undefined) {
      const problem = reminderScheduleProblem(request.reminderOffsetsDays);
      if (problem) throw new UnprocessableEntityException(problem);
      changes.reminderOffsetsDays = request.reminderOffsetsDays;
    }
    if (request.bin !== undefined) {
      if (request.bin !== null) {
        const problem = binProblem(request.bin);
        if (problem) throw new UnprocessableEntityException(problem);
      }
      changes.bin = request.bin;
    }
    if (request.address !== undefined) {
      const { minLength, maxLength } = TAX_IDENTITY_CONSTRAINTS.address;
      if (
        request.address !== null &&
        (typeof request.address !== 'string' ||
          request.address.trim().length < minLength ||
          request.address.length > maxLength)
      ) {
        throw new UnprocessableEntityException(`address must be ${minLength}-${maxLength} characters.`);
      }
      changes.address = request.address === null ? null : request.address.trim();
    }
    if (request.timeZone !== undefined) {
      const problem = timeZoneProblem(request.timeZone);
      if (problem) throw new UnprocessableEntityException(problem);
      changes.timeZone = request.timeZone;
    } else if (changes.bin && current.timeZone === DEFAULT_TIME_ZONE) {
      // A BIN is Bangladeshi, and Bangladesh has one time zone: a tax invoice's time of issue must
      // not print in UTC just because nobody thought to set it.
      changes.timeZone = BANGLADESH_TIME_ZONE;
    }
    if (request.authorizedSignatory !== undefined) {
      if (request.authorizedSignatory === null) {
        changes.signatoryName = null;
        changes.signatoryDesignation = null;
      } else {
        const problem = signatoryProblem(request.authorizedSignatory);
        if (problem) throw new UnprocessableEntityException(problem);
        changes.signatoryName = request.authorizedSignatory.name.trim();
        changes.signatoryDesignation = request.authorizedSignatory.designation.trim();
      }
    }
    // The form's seller block is name, BIN *and* address: a BIN without an address can't issue one.
    const bin = changes.bin !== undefined ? changes.bin : current.bin;
    const address = changes.address !== undefined ? changes.address : current.address;
    if (bin && !address) {
      throw new UnprocessableEntityException(
        'An organization with a BIN needs its address (the challan-issuing address).',
      );
    }

    if (Object.keys(changes).length > 0) {
      await this.organizations.update({ id }, changes);
    }
    return this.findOne(id);
  }

  private toResponse(organization: OrganizationEntity): OrganizationResponse {
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      invoicePrefix: organization.invoicePrefix,
      reminderOffsetsDays: organization.reminderOffsetsDays,
      bin: organization.bin ?? null,
      address: organization.address ?? null,
      timeZone: organization.timeZone,
      authorizedSignatory:
        organization.signatoryName && organization.signatoryDesignation
          ? { name: organization.signatoryName, designation: organization.signatoryDesignation }
          : null,
      isActive: organization.isActive,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    };
  }
}
