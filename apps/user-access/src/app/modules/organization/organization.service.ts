import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Saga, SagaExecutionError } from '@libs/saga';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { buildPaginationMeta, reminderScheduleProblem } from '@libs/shared/types';
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
    const { invoicePrefix, reminderOffsetsDays } = await this.findOne(id);
    return { invoicePrefix, reminderOffsetsDays };
  }

  /**
   * An organization's admin changing its own settings. Re-validated here: RPC payloads skip the
   * gateway's DTO validation, and only these three fields can ever be written this way.
   */
  async updateSettings(id: string, request: UpdateCurrentOrganizationRequest): Promise<OrganizationResponse> {
    const changes: Partial<Pick<OrganizationEntity, 'name' | 'invoicePrefix' | 'reminderOffsetsDays'>> = {};
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
      isActive: organization.isActive,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    };
  }
}
