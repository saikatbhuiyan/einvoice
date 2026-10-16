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
const PERMISSIONS_BY_ROLE: Record<string, string[]> = {
  accountant: ['invoice:read', 'invoice:write'],
  viewer: ['invoice:read'],
};

@Controller()
class StubAuthorizer {
  @GrpcMethod('AuthorizerService', 'GetPermissionsForRoles')
  getPermissionsForRoles({ roles }: { roles: string[] }) {
    return { permissions: [...new Set(roles.flatMap((role) => PERMISSIONS_BY_ROLE[role] ?? []))] };
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

  it('resolves a Keycloak role list into permissions', async () => {
    await expect(resolver.getPermissionsForRoles(['accountant'])).resolves.toEqual(['invoice:read', 'invoice:write']);
  });

  it('returns an empty list (not undefined) for a caller whose roles grant nothing', async () => {
    await expect(resolver.getPermissionsForRoles(['default-roles-einvoice'])).resolves.toEqual([]);
  });

  it('sends an empty role list and gets an empty answer', async () => {
    await expect(resolver.getPermissionsForRoles([])).resolves.toEqual([]);
  });

  // Documents current behavior: with Authorizer down, the gRPC error propagates as-is (bff's
  // GlobalExceptionFilter turns it into a 500, not a 503). See the gRPC series, Part 5.
  it('rejects with the gRPC UNAVAILABLE error when Authorizer is down', async () => {
    await stub.close();

    await expect(resolver.getPermissionsForRoles(['viewer'])).rejects.toMatchObject({ code: 14 });
  });
});
