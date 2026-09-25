import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import type express from 'express';
import Redis from 'ioredis';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { REDIS_CLIENT } from '@libs/cache';
import { CIRCUIT_BREAKER_FACTORY } from '@libs/circuit-breaker';
import type { CircuitBreakerFactory } from '@libs/circuit-breaker';
import { ServiceName } from '@libs/transports';
import {
  CreateUserRequest,
  DeactivateUserResponse,
  FindAllRolesResponse,
  FindAllUsersRequest,
  FindAllUsersResponse,
  UpdateUserRequest,
  UserResponse,
} from '@libs/interfaces/gateway';
import { UserClientService } from './user-client.service';

const BFF_PREFIX = 'bff';
const CACHE_KEY_LIST = (version: number, hash: string) => `${BFF_PREFIX}:user:list:${version}:${hash}`;
const CACHE_KEY_LIST_VERSION = `${BFF_PREFIX}:user:list:version`;
const CACHE_KEY_ROLES = `${BFF_PREFIX}:role:list`;
const TTL_LIST_MS = 10_000;
const TTL_ROLES_MS = 60_000;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly redis: Redis;

  constructor(
    private readonly userClient: UserClientService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject(REDIS_CLIENT) redis: Redis,
    @Optional() @Inject(CIRCUIT_BREAKER_FACTORY) private readonly cbFactory?: CircuitBreakerFactory,
  ) {
    this.redis = redis;
  }

  async create(payload: CreateUserRequest): Promise<UserResponse> {
    const user = await this.userClient.createUser(payload);
    await this.bumpListVersion();
    return user;
  }

  async findAll(query: FindAllUsersRequest, res?: express.Response): Promise<FindAllUsersResponse> {
    const version = await this.getListVersion();
    const hash = this.hashQuery(query);
    const cacheKey = CACHE_KEY_LIST(version, hash);

    try {
      const cached = await this.cacheManager.get<FindAllUsersResponse>(cacheKey);
      if (cached) return cached;
    } catch {
      this.logger.warn(`Cache read failed for key "${cacheKey}"`);
    }

    try {
      const result = await this.userClient.findAllUsers(query);

      try {
        await this.cacheManager.set(cacheKey, result, TTL_LIST_MS);
      } catch {
        this.logger.warn(`Cache write failed for key "${cacheKey}"`);
      }

      return result;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        const breaker = this.cbFactory?.get(ServiceName.USER);
        const circuitState = breaker?.getMetrics().state;

        if (circuitState && res) {
          res.setHeader('X-Circuit-State', circuitState);
        }

        try {
          const cached = await this.cacheManager.get<FindAllUsersResponse>(cacheKey);
          if (cached) {
            if (res) {
              res.setHeader('X-Served-From', 'cache');
            }
            this.logger.warn('Circuit open for user-access service. Returning cached list data.');
            return cached;
          }
        } catch {
          this.logger.warn(`Cache read failed for key "${cacheKey}" during circuit open fallback`);
        }
      }
      throw error;
    }
  }

  async findOne(id: string): Promise<UserResponse> {
    return this.userClient.findOneUser(id);
  }

  async update(id: string, payload: UpdateUserRequest): Promise<UserResponse> {
    const user = await this.userClient.updateUser(id, payload);
    await this.bumpListVersion();
    return user;
  }

  async deactivate(id: string): Promise<DeactivateUserResponse> {
    const result = await this.userClient.deactivateUser(id);
    await this.bumpListVersion();
    return result;
  }

  async findAllRoles(): Promise<FindAllRolesResponse> {
    try {
      const cached = await this.cacheManager.get<FindAllRolesResponse>(CACHE_KEY_ROLES);
      if (cached) return cached;
    } catch {
      this.logger.warn(`Cache read failed for key "${CACHE_KEY_ROLES}"`);
    }

    const result = await this.userClient.findAllRoles();

    try {
      await this.cacheManager.set(CACHE_KEY_ROLES, result, TTL_ROLES_MS);
    } catch {
      this.logger.warn(`Cache write failed for key "${CACHE_KEY_ROLES}"`);
    }

    return result;
  }

  private async getListVersion(): Promise<number> {
    try {
      const version = await this.redis.get(CACHE_KEY_LIST_VERSION);
      return version ? Number(version) : 1;
    } catch {
      this.logger.warn('Failed to read list version counter, defaulting to 1');
      return 1;
    }
  }

  private async bumpListVersion(): Promise<void> {
    try {
      await this.redis.incr(CACHE_KEY_LIST_VERSION);
    } catch {
      this.logger.warn('Failed to increment list version counter');
    }
  }

  private hashQuery(query: FindAllUsersRequest): string {
    return createHash('sha256').update(JSON.stringify(query)).digest('hex').slice(0, 16);
  }
}
