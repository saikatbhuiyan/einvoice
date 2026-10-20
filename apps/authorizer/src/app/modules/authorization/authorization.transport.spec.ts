import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Controller, INestMicroservice } from '@nestjs/common';
import { ClientGrpcProxy, ClientsModule, GrpcMethod, type MicroserviceOptions } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { firstValueFrom, type Observable } from 'rxjs';
import { createGrpcClientConfig, createGrpcServerConfig, GrpcServiceName } from '@libs/transports';
import { forTest, freePort } from '@libs/transports/transport-test-harness';
import { AuthorizationController } from './authorization.controller';
import { AuthorizationService } from './authorization.service';
import type { GrpcMembership, GrpcRole } from './grpc-contracts';

/**
 * Transport test: Authorizer as it really runs — a gRPC server whose handler calls a real gRPC
 * client — with only user-access replaced by a fake gRPC server (both of its services, from the real
 * user-access.proto). Everything between them is real: proto loading, protobuf encoding, and
 * proto3's handling of default values (empty strings and lists) on the wire.
 */
const ROLES: GrpcRole[] = [
  {
    id: '1',
    name: 'admin',
    description: '',
    permissions: ['invoice:read', 'invoice:write'],
    isActive: true,
    scope: 'organization',
  },
  {
    id: '2',
    name: 'platform-admin',
    description: '',
    permissions: ['platform:admin'],
    isActive: true,
    scope: 'platform',
  },
];

const MEMBERSHIPS: Record<string, GrpcMembership[]> = {
  'kc-two-orgs': [
    {
      organizationId: 'org-acme',
      organizationName: 'Acme',
      roleName: 'admin',
      permissions: ['invoice:read', 'invoice:write'],
    },
    { organizationId: 'org-globex', organizationName: 'Globex', roleName: 'viewer', permissions: ['invoice:read'] },
  ],
  'kc-one-org': [
    { organizationId: 'org-acme', organizationName: 'Acme', roleName: 'viewer', permissions: ['invoice:read'] },
  ],
};

@Controller()
class FakeUserAccessController {
  membershipCalls = 0;

  @GrpcMethod('RoleQueryService', 'FindAllRoles')
  findAllRoles() {
    return { roles: ROLES };
  }

  @GrpcMethod('MembershipQueryService', 'ResolveMembership')
  resolveMembership({ keycloakUserId }: { keycloakUserId: string }) {
    this.membershipCalls += 1;
    return { memberships: MEMBERSHIPS[keycloakUserId] ?? [] };
  }
}

interface AuthorizerClient {
  resolveCaller(request: { userId: string; roles: string[]; organizationId: string }): Observable<{
    status: string;
    organizationId: string;
    roleName: string;
    permissions: string[];
    memberships: Array<{ organizationId: string; organizationName: string; roleName: string }>;
  }>;
}

describe('Authorizer over gRPC (transport)', () => {
  let userAccess: INestMicroservice;
  let authorizer: INestMicroservice;
  let client: ClientGrpcProxy;
  let authorizerClient: AuthorizerClient;
  let fakeUserAccess: FakeUserAccessController;
  const cacheStore = new Map<string, unknown>();

  beforeAll(async () => {
    const [userAccessPort, authorizerPort] = [await freePort(), await freePort()];

    const userAccessModule = await Test.createTestingModule({ controllers: [FakeUserAccessController] }).compile();
    userAccess = userAccessModule.createNestMicroservice<MicroserviceOptions>(
      forTest(createGrpcServerConfig(GrpcServiceName.USER_ACCESS_ROLE_QUERY), userAccessPort),
    );
    await userAccess.listen();
    fakeUserAccess = userAccessModule.get(FakeUserAccessController);

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

  const resolve = (userId: string, organizationId = '', roles: string[] = []) =>
    firstValueFrom(authorizerClient.resolveCaller({ userId, roles, organizationId }));

  it('resolves the requested organization across both gRPC hops', async () => {
    await expect(resolve('kc-two-orgs', 'org-globex')).resolves.toEqual({
      status: 'resolved',
      organizationId: 'org-globex',
      roleName: 'viewer',
      permissions: ['invoice:read'],
      memberships: [
        { organizationId: 'org-acme', organizationName: 'Acme', roleName: 'admin' },
        { organizationId: 'org-globex', organizationName: 'Globex', roleName: 'viewer' },
      ],
    });
  });

  // GRPC_LOADER_OPTIONS: proto3 drops empty strings/lists on the wire; bff must still see them.
  it('delivers an ambiguous result with empty strings and lists as values, not missing fields', async () => {
    await expect(resolve('kc-two-orgs')).resolves.toEqual({
      status: 'ambiguous',
      organizationId: '',
      roleName: '',
      permissions: [],
      memberships: expect.any(Array),
    });
  });

  it('resolves the only membership without a requested organization', async () => {
    await expect(resolve('kc-one-org')).resolves.toMatchObject({ status: 'resolved', organizationId: 'org-acme' });
  });

  it('gives a platform admin with no memberships only platform permissions', async () => {
    await expect(resolve('kc-nobody', '', ['platform-admin'])).resolves.toEqual({
      status: 'none',
      organizationId: '',
      roleName: '',
      permissions: ['platform:admin'],
      memberships: [],
    });
  });

  it('serves a repeat request from its membership cache without calling user-access again', async () => {
    await resolve('kc-one-org');
    const callsAfterFirst = fakeUserAccess.membershipCalls;

    await resolve('kc-one-org');

    expect(fakeUserAccess.membershipCalls).toBe(callsAfterFirst);
  });
});
