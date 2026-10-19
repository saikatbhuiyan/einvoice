import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Controller, INestMicroservice } from '@nestjs/common';
import { ClientGrpcProxy, ClientsModule, GrpcMethod, type MicroserviceOptions } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { firstValueFrom, type Observable } from 'rxjs';
import { createGrpcClientConfig, createGrpcServerConfig, GrpcServiceName } from '@libs/transports';
import { forTest, freePort } from '@libs/transports/transport-test-harness';
import { AuthorizationController } from './authorization.controller';
import { AuthorizationService } from './authorization.service';
import type { GrpcRole } from './grpc-contracts';

/**
 * Transport test: Authorizer as it really runs — a gRPC server whose handler calls a real gRPC
 * client — with only user-access replaced by a fake gRPC server. Everything between the two is
 * real: proto loading, protobuf encoding, and proto3's handling of default values on the wire.
 */
const ROLES: GrpcRole[] = [
  { id: '1', name: 'accountant', description: 'Books', permissions: ['invoice:read', 'invoice:write'], isActive: true },
  { id: '2', name: 'viewer', description: '', permissions: ['invoice:read'], isActive: true },
  // A role with no permissions is legitimate (e.g. a newly created or suspended role).
  { id: '3', name: 'auditor-pending', description: '', permissions: [], isActive: true },
];

@Controller()
class FakeRoleQueryController {
  calls = 0;

  @GrpcMethod('RoleQueryService', 'FindAllRoles')
  findAllRoles() {
    this.calls += 1;
    return { roles: ROLES };
  }
}

interface AuthorizerClient {
  getPermissionsForRoles(request: { roles: string[] }): Observable<{ permissions?: string[] }>;
}

describe('Authorizer over gRPC (transport)', () => {
  let userAccess: INestMicroservice;
  let authorizer: INestMicroservice;
  let client: ClientGrpcProxy;
  let authorizerClient: AuthorizerClient;
  let fakeRoles: FakeRoleQueryController;
  const cacheStore = new Map<string, unknown>();

  beforeAll(async () => {
    const [userAccessPort, authorizerPort] = [await freePort(), await freePort()];

    const userAccessModule = await Test.createTestingModule({ controllers: [FakeRoleQueryController] }).compile();
    userAccess = userAccessModule.createNestMicroservice<MicroserviceOptions>(
      forTest(createGrpcServerConfig(GrpcServiceName.USER_ACCESS_ROLE_QUERY), userAccessPort),
    );
    await userAccess.listen();
    fakeRoles = userAccessModule.get(FakeRoleQueryController);

    const authorizerModule = await Test.createTestingModule({
      imports: [
        ClientsModule.register([
          forTest(createGrpcClientConfig(GrpcServiceName.USER_ACCESS_ROLE_QUERY), userAccessPort),
        ]),
      ],
      controllers: [AuthorizationController],
      providers: [
        AuthorizationService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: async (key: string) => cacheStore.get(key),
            set: async (key: string, value: unknown) => void cacheStore.set(key, value),
          },
        },
      ],
    }).compile();
    authorizer = authorizerModule.createNestMicroservice<MicroserviceOptions>(
      forTest(createGrpcServerConfig(GrpcServiceName.AUTHORIZER), authorizerPort),
    );
    await authorizer.listen();

    const clientConfig = forTest(createGrpcClientConfig(GrpcServiceName.AUTHORIZER), authorizerPort);
    client = new ClientGrpcProxy(clientConfig.options);
    authorizerClient = client.getService<AuthorizerClient>('AuthorizerService');
  });

  afterAll(async () => {
    client?.close();
    await authorizer?.close();
    await userAccess?.close();
  });

  beforeEach(() => cacheStore.clear());

  const resolve = (roles: string[]) => firstValueFrom(authorizerClient.getPermissionsForRoles({ roles }));

  it('resolves a role list to permissions across both gRPC hops', async () => {
    const response = await resolve(['accountant', 'viewer']);

    expect(response.permissions?.sort()).toEqual(['invoice:read', 'invoice:write']);
  });

  it('serves the second request from its roles cache without calling user-access again', async () => {
    const before = fakeRoles.calls;

    await resolve(['viewer']);
    await resolve(['accountant']);

    expect(fakeRoles.calls - before).toBe(1);
  });

  // proto3 does not put an empty repeated field on the wire, so a caller with no roles arrives at
  // the server as {} and an empty answer arrives at the client with no permissions key at all.
  it('handles a caller with no roles: empty in, empty out', async () => {
    const response = await resolve([]);

    expect(response.permissions ?? []).toEqual([]);
  });

  it('grants nothing for a role that has no permissions', async () => {
    const response = await resolve(['auditor-pending']);

    expect(response.permissions ?? []).toEqual([]);
  });

  it('grants exactly the other role’s permissions when combined with an empty role', async () => {
    const response = await resolve(['auditor-pending', 'viewer']);

    expect(response.permissions).toEqual(['invoice:read']);
  });
});
