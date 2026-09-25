import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_LIMIT, DEFAULT_PAGE } from '@libs/constants';
import { CreateUserRequest, FindAllUsersRequest, UpdateUserRequest } from '@libs/interfaces/gateway';
import { UserEntity } from '../../../database/entities/user.entity';
import { IUserRepository, PaginatedResult } from './user.repository.interface';

@Injectable()
export class UserRepository implements IUserRepository {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repository: Repository<UserEntity>,
  ) {}

  async create(data: CreateUserRequest): Promise<UserEntity> {
    const user = this.repository.create(data);
    const saved = await this.repository.save(user);
    // save() doesn't populate the eager `role` relation on the entity it returns (eager
    // loading only applies to find/findOne queries), so re-fetch to get a complete entity.
    return (await this.findById(saved.id)) as UserEntity;
  }

  async findAll(query: FindAllUsersRequest): Promise<PaginatedResult<UserEntity>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;

    // eager: true on the role relation only auto-joins for repository.find()/findOne(),
    // not for createQueryBuilder() -- without this the mapped response crashes on user.role.
    const qb = this.repository.createQueryBuilder('user').leftJoinAndSelect('user.role', 'role');

    if (query.roleId) {
      qb.andWhere('user.roleId = :roleId', { roleId: query.roleId });
    }

    if (query.isActive !== undefined) {
      qb.andWhere('user.isActive = :isActive', { isActive: query.isActive });
    }

    if (query.search) {
      qb.andWhere('(user.name ILIKE :search OR user.email ILIKE :search)', { search: `%${query.search}%` });
    }

    qb.orderBy('user.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();

    return { items, total };
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async update(id: string, data: UpdateUserRequest): Promise<UserEntity | null> {
    const exists = await this.repository.exists({ where: { id } });
    if (!exists) return null;

    // A direct UPDATE, not find+merge+save: this entity has both a `role` relation and its
    // underlying `roleId` join column. If an entity instance with an already-loaded (and by
    // now stale) `role` were save()'d, TypeORM resolves the join column from that loaded
    // relation and silently overwrites the roleId we just merged in. Updating the column
    // directly sidesteps relation resolution entirely.
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async deactivate(id: string): Promise<UserEntity | null> {
    const exists = await this.repository.exists({ where: { id } });
    if (!exists) return null;

    await this.repository.update(id, { isActive: false });
    return this.findById(id);
  }
}
