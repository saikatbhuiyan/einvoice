import { Controller, type INestMicroservice } from '@nestjs/common';
import { ClientsModule, GrpcMethod, type MicroserviceOptions } from '@nestjs/microservices';
import { Test, type TestingModule } from '@nestjs/testing';
import { createGrpcClientConfig, createGrpcServerConfig, GrpcServiceName } from '@libs/transports';
import { forTest, freePort } from '@libs/transports/transport-test-harness';
import { AuthorizerPermissionResolver } from './authorizer-permission.resolver';

/**
 * Consumer-side contract test for bff → Authorizer: bff's real resolver and gRPC client config
 * against a stub Authorizer served from the real authorizer.proto. The resolver's client
 * interface is hand-written (no codegen), so this is what proves its method name and message
 * fields actually line up with the proto. Authorizer's own transport spec covers the provider side.
 */
const MEMBERSHIPS = [
  { organizationId: 'org-acme', organizationName: 'Acme', roleName: 'accountant' },
  { organizationId: 'org-globex', organizationName: 'Globex', roleName: 'viewer' },
];

@Controller()
class StubAuthorizer {
  lastRequest: unknown;

  @GrpcMethod('AuthorizerService', 'ResolveCaller')
  resolveCaller(request: { userId: string; roles: string[]; organizationId: string }) {
    this.lastRequest = request;
    if (request.organizationId === 'org-acme') {
      return {
        status: 'resolved',
        organizationId: 'org-acme',
        roleName: 'accountant',
        permissions: ['invoice:read', 'invoice:write'],
        memberships: MEMBERSHIPS,
      };
    }
    if (request.organizationId) {
      return { status: 'not_member', organizationId: '', roleName: '', permissions: [], memberships: MEMBERSHIPS };
    }
    // proto3: empty strings and lists are dropped on the wire; the consumer must cope.
    return { status: 'ambiguous', memberships: MEMBERSHIPS };
  }
}

describe('bff → Authorizer over gRPC (consumer contract)', () => {
  let stub: INestMicroservice;
  let consumer: TestingModule;
  let resolver: AuthorizerPermissionResolver;
  let port: number;

  beforeAll(async () => {
    port = await freePort();
    const stubModule = await Test.createTestingModule({ controllers: [StubAuthorizer] }).compile();
    stub = stubModule.createNestMicroservice<MicroserviceOptions>(
      forTest(createGrpcServerConfig(GrpcServiceName.AUTHORIZER), port),
    );
    await stub.listen();

    consumer = await Test.createTestingModule({
      imports: [ClientsModule.register([forTest(createGrpcClientConfig(GrpcServiceName.AUTHORIZER), port)])],
      providers: [AuthorizerPermissionResolver],
    }).compile();
    await consumer.init();
    resolver = consumer.get(AuthorizerPermissionResolver);
  });

  afterAll(async () => {
    // Stub first: if setup failed partway, closing the consumer may not settle, and a stub server
    // left listening keeps Jest alive — a failing suite would then hang CI instead of failing.
    await stub?.close();
    await consumer?.close();
  });

  it('sends the caller and requested organization, and maps a resolved answer', async () => {
    await expect(resolver.resolveCaller({ userId: 'kc-1', roles: ['platform-admin'] }, 'org-acme')).resolves.toEqual({
      status: 'resolved',
      organizationId: 'org-acme',
      roleName: 'accountant',
      permissions: ['invoice:read', 'invoice:write'],
      memberships: MEMBERSHIPS,
    });
    expect(stub.get(StubAuthorizer).lastRequest).toEqual({
      userId: 'kc-1',
      roles: ['platform-admin'],
      organizationId: 'org-acme',
    });
  });

  it('sends an empty organization when none was requested', async () => {
    await resolver.resolveCaller({ userId: 'kc-1', roles: [] });

    expect(stub.get(StubAuthorizer).lastRequest).toMatchObject({ organizationId: '' });
  });

  it('maps an answer whose empty fields were dropped on the wire to "no organization, no permissions"', async () => {
    await expect(resolver.resolveCaller({ userId: 'kc-1', roles: [] })).resolves.toEqual({
      status: 'ambiguous',
      organizationId: undefined,
      roleName: undefined,
      permissions: [],
      memberships: MEMBERSHIPS,
    });
  });

  it('never reports an organization for a non-member', async () => {
    await expect(resolver.resolveCaller({ userId: 'kc-1', roles: [] }, 'org-other')).resolves.toMatchObject({
      status: 'not_member',
      organizationId: undefined,
    });
  });
});
