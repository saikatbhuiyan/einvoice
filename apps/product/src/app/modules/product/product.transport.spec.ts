import { Logger, NotFoundException, type INestApplication } from '@nestjs/common';
import { ClientProxyFactory, Transport, type ClientProxy, type MicroserviceOptions } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { RpcPermissionGuard } from '@libs/auth/rpc-permission.guard';
import { RpcExceptionInterceptor, RpcLoggingInterceptor } from '@libs/interceptors';
import { getCurrentCorrelationContext, runWithCorrelationContext, type CorrelationContext } from '@libs/logging';
import { BaseTcpClient, createTcpServerConfig, ServiceName, TCP_PATTERNS } from '@libs/transports';
import { freePort } from '@libs/transports/transport-test-harness';
import { ProductRpcController } from './product-rpc.controller';
import { ProductService } from './product.service';

/**
 * Transport test: product's real RPC controller over a real TCP socket, with the global guard and
 * interceptors main.ts registers; only ProductService is stubbed. FIND_MANY is called by invoice
 * (not bff) while it resolves an invoice's catalog lines, on behalf of the user creating it -- so
 * the user's identity and organization must arrive with invoice's call.
 */
class TestProductClient extends BaseTcpClient {
  protected readonly logger = new Logger('TestProductClient');
  protected readonly serviceName = ServiceName.PRODUCT;

  constructor(
    protected readonly client: ClientProxy,
    protected override readonly sourceService: string,
  ) {
    super();
  }

  call<T>(pattern: string, payload: unknown): Promise<T> {
    return this.send<T, unknown>(pattern, payload);
  }
}

const ORG = 'org-acme';
const ID = '3f1b3c9a-7e3d-4a2c-9c1e-6b1a4a9c2f10';
// The accountant role: invoices, and reading (not editing) the catalog.
const ACCOUNTANT = { userId: 'kc-user-1', organizationId: ORG, permissions: ['invoice:write', 'product:read'] };
const MANAGER = { userId: 'kc-user-2', organizationId: ORG, permissions: ['product:read', 'product:write'] };

describe('product over TCP (transport)', () => {
  let app: INestApplication;
  let tcp: ClientProxy;
  let fromInvoice: TestProductClient;
  let fromBff: TestProductClient;
  let seenContext: CorrelationContext | undefined;

  const productService = {
    findOne: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
  };

  const as = <T>(identity: Partial<CorrelationContext>, call: () => Promise<T>) =>
    runWithCorrelationContext({ correlationId: 'transport-spec', traceId: 'transport-spec', ...identity }, call);

  beforeAll(async () => {
    const port = await freePort();

    const moduleRef = await Test.createTestingModule({
      controllers: [ProductRpcController],
      providers: [RpcPermissionGuard, { provide: ProductService, useValue: productService }],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalInterceptors(new RpcLoggingInterceptor(), new RpcExceptionInterceptor());
    app.useGlobalGuards(app.get(RpcPermissionGuard));

    const tcpConfig = createTcpServerConfig(ServiceName.PRODUCT);
    app.connectMicroservice<MicroserviceOptions>(
      { ...tcpConfig, options: { ...tcpConfig.options, host: '127.0.0.1', port } },
      { inheritAppConfig: true },
    );
    await app.startAllMicroservices();
    await app.init();

    tcp = ClientProxyFactory.create({ transport: Transport.TCP, options: { host: '127.0.0.1', port } });
    fromInvoice = new TestProductClient(tcp, 'invoice');
    fromBff = new TestProductClient(tcp, 'bff');
  });

  // Servers before clients: see CLAUDE.md's transport-layer note.
  afterAll(async () => {
    await app?.close();
    await tcp?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    seenContext = undefined;
  });

  it("FIND_MANY from invoice runs as the invoicing user, in the user's organization", async () => {
    productService.findMany.mockImplementation(async () => {
      seenContext = getCurrentCorrelationContext();
      return [{ id: ID }];
    });

    await expect(
      as(ACCOUNTANT, () => fromInvoice.call(TCP_PATTERNS.PRODUCT.FIND_MANY, { ids: [ID] })),
    ).resolves.toEqual([{ id: ID }]);
    expect(productService.findMany).toHaveBeenCalledWith([ID]);
    expect(seenContext).toMatchObject({ userId: 'kc-user-1', organizationId: ORG, sourceService: 'invoice' });
  });

  it('FIND_MANY is refused without product:read, and without an organization', async () => {
    await expect(
      as({ ...ACCOUNTANT, permissions: ['invoice:write'] }, () =>
        fromInvoice.call(TCP_PATTERNS.PRODUCT.FIND_MANY, { ids: [ID] }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      as({ ...ACCOUNTANT, organizationId: undefined }, () =>
        fromInvoice.call(TCP_PATTERNS.PRODUCT.FIND_MANY, { ids: [ID] }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(productService.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['UPDATE', { id: ID, data: { unitPrice: 165 } }, 'update'],
    ['DEACTIVATE', { id: ID }, 'deactivate'],
  ] as const)('%s needs product:write', async (pattern, payload, method) => {
    productService[method].mockResolvedValue({ id: ID });

    await expect(as(ACCOUNTANT, () => fromBff.call(TCP_PATTERNS.PRODUCT[pattern], payload))).rejects.toMatchObject({
      status: 403,
    });
    expect(productService[method]).not.toHaveBeenCalled();

    await expect(as(MANAGER, () => fromBff.call(TCP_PATTERNS.PRODUCT[pattern], payload))).resolves.toEqual({ id: ID });
  });

  it('UPDATE passes the id and the changes through', async () => {
    productService.update.mockResolvedValue({ id: ID });

    await as(MANAGER, () => fromBff.call(TCP_PATTERNS.PRODUCT.UPDATE, { id: ID, data: { sdRate: 20 } }));

    expect(productService.update).toHaveBeenCalledWith(ID, { sdRate: 20 });
  });

  it('FIND_ONE delivers a missing product to the caller as a 404', async () => {
    productService.findOne.mockRejectedValue(new NotFoundException(`Product not found for id "${ID}".`));

    await expect(as(ACCOUNTANT, () => fromBff.call(TCP_PATTERNS.PRODUCT.FIND_ONE, { id: ID }))).rejects.toMatchObject({
      status: 404,
    });
  });
});
