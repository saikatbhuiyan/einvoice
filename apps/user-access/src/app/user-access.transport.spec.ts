import type { INestApplication } from '@nestjs/common';
import {
  ClientGrpcProxy,
  ClientProxyFactory,
  Transport,
  type ClientProxy,
  type MicroserviceOptions,
} from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { firstValueFrom, type Observable } from 'rxjs';
import { RpcPermissionGuard } from '@libs/auth/rpc-permission.guard';
import { RpcExceptionInterceptor } from '@libs/interceptors';
import { runWithCorrelationContext } from '@libs/logging';
import {
  createGrpcClientConfig,
  createGrpcServerConfig,
  createRpcEnvelope,
  createTcpServerConfig,
  GrpcServiceName,
  ServiceName,
  TCP_PATTERNS,
} from '@libs/transports';
import { forTest, freePort } from '@libs/transports/transport-test-harness';
import { RoleGrpcController } from './modules/role/role-grpc.controller';
import { RoleRpcController } from './modules/role/role-rpc.controller';
import { RoleService } from './modules/role/role.service';
import { UserRpcController } from './modules/user/user-rpc.controller';
import { UserService } from './modules/user/user.service';

/**
 * Transport test: user-access's real RPC controllers, served over real TCP and gRPC sockets, with
 * the same global RpcPermissionGuard + RpcExceptionInterceptor main.ts registers. Only the service
 * layer is stubbed. This is the layer that would have caught the gRPC-series bug (a global
 * TCP-envelope guard rejecting every gRPC call) before a live run did.
 */
const roles = {
  items: [
    { id: 'r1', name: 'accountant', description: 'Books', permissions: ['invoice:read'], isActive: true },
    { id: 'r2', name: 'pending', description: undefined, permissions: [], isActive: true },
  ],
};

interface RoleQueryClient {
  findAllRoles(request: Record<string, never>): Observable<{
    roles: Array<{ name: string; description: string; permissions: string[]; isActive: boolean }>;
  }>;
}

const asCaller = <T>(data: T, identity: { userId?: string; permissions?: string[] }) =>
  runWithCorrelationContext({ correlationId: 'transport-spec', traceId: 'transport-spec', ...identity }, () =>
    createRpcEnvelope(data, 'bff'),
  );

describe('user-access over TCP and gRPC (transport)', () => {
  let app: INestApplication;
  let tcp: ClientProxy;
  let grpc: ClientGrpcProxy;
  let roleQuery: RoleQueryClient;
  const userService = { findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }) };

  beforeAll(async () => {
    const [tcpPort, grpcPort] = [await freePort(), await freePort()];

    const moduleRef = await Test.createTestingModule({
      controllers: [RoleGrpcController, RoleRpcController, UserRpcController],
      providers: [
        RpcPermissionGuard,
        { provide: RoleService, useValue: { findAll: jest.fn().mockResolvedValue(roles) } },
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalInterceptors(new RpcExceptionInterceptor());
    app.useGlobalGuards(app.get(RpcPermissionGuard));

    const tcpConfig = createTcpServerConfig(ServiceName.USER);
    app.connectMicroservice<MicroserviceOptions>(
      { ...tcpConfig, options: { ...tcpConfig.options, host: '127.0.0.1', port: tcpPort } },
      { inheritAppConfig: true },
    );
    app.connectMicroservice<MicroserviceOptions>(
      forTest(createGrpcServerConfig(GrpcServiceName.USER_ACCESS_ROLE_QUERY), grpcPort),
      { inheritAppConfig: true },
    );
    await app.startAllMicroservices();
    await app.init();

    tcp = ClientProxyFactory.create({ transport: Transport.TCP, options: { host: '127.0.0.1', port: tcpPort } });
    grpc = new ClientGrpcProxy(
      forTest(createGrpcClientConfig(GrpcServiceName.USER_ACCESS_ROLE_QUERY), grpcPort).options,
    );
    roleQuery = grpc.getService<RoleQueryClient>('RoleQueryService');
  });

  afterAll(async () => {
    await tcp?.close();
    grpc?.close();
    await app?.close();
  });

  describe('gRPC RoleQueryService (called by Authorizer, no RpcEnvelope)', () => {
    it('is reachable without an envelope because the handler is @Public()', async () => {
      const { roles: received } = await firstValueFrom(roleQuery.findAllRoles({}));

      expect(received.map((role) => role.name)).toEqual(['accountant', 'pending']);
    });

    // GRPC_LOADER_OPTIONS: proto3 drops default values on the wire; the client must still see them.
    it('delivers empty lists and empty strings as values, not as missing fields', async () => {
      const { roles: received } = await firstValueFrom(roleQuery.findAllRoles({}));

      expect(received[1]).toEqual({ id: 'r2', name: 'pending', description: '', permissions: [], isActive: true });
    });
  });

  describe('TCP surface (called by bff, enveloped)', () => {
    it('rejects a raw, un-enveloped message with a 401-shaped RPC error', async () => {
      await expect(firstValueFrom(tcp.send(TCP_PATTERNS.ROLE.FIND_ALL, {}))).rejects.toMatchObject({
        status: 401,
        message: 'This call requires an authenticated caller.',
      });
    });

    it('serves ROLE.FIND_ALL to any authenticated caller, with no permission requirement', async () => {
      const response = await firstValueFrom(
        tcp.send(TCP_PATTERNS.ROLE.FIND_ALL, asCaller(undefined, { userId: 'u-1' })),
      );

      expect(response).toEqual(roles);
    });

    it('rejects USER.FIND_ALL for a caller without user:read with a 403-shaped RPC error', async () => {
      const envelope = asCaller({ page: 1, limit: 10 }, { userId: 'u-1', permissions: ['invoice:read'] });

      await expect(firstValueFrom(tcp.send(TCP_PATTERNS.USER.FIND_ALL, envelope))).rejects.toMatchObject({
        status: 403,
        message: 'Missing required permission(s): user:read.',
      });
      expect(userService.findAll).not.toHaveBeenCalled();
    });

    it('serves USER.FIND_ALL and passes the unwrapped payload to the service', async () => {
      const envelope = asCaller({ page: 2, limit: 5 }, { userId: 'u-1', permissions: ['user:read'] });

      await expect(firstValueFrom(tcp.send(TCP_PATTERNS.USER.FIND_ALL, envelope))).resolves.toEqual({
        items: [],
        total: 0,
      });
      expect(userService.findAll).toHaveBeenCalledWith({ page: 2, limit: 5 });
    });
  });
});
