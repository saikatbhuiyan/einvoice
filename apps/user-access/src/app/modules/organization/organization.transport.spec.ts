import { Logger, type INestApplication } from '@nestjs/common';
import { ClientProxyFactory, Transport, type ClientProxy, type MicroserviceOptions } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { RpcPermissionGuard } from '@libs/auth/rpc-permission.guard';
import { RpcExceptionInterceptor, RpcLoggingInterceptor } from '@libs/interceptors';
import { runWithCorrelationContext, type CorrelationContext } from '@libs/logging';
import { BaseTcpClient, createTcpServerConfig, ServiceName, TCP_PATTERNS } from '@libs/transports';
import { freePort } from '@libs/transports/transport-test-harness';
import { OrganizationRpcController } from './organization-rpc.controller';
import { OrganizationService } from './organization.service';

/**
 * Transport test: user-access's real organization RPC controller over a real TCP socket, with the
 * global guard and interceptors main.ts registers; only OrganizationService is stubbed.
 */
class TestClient extends BaseTcpClient {
  protected readonly logger = new Logger('TestClient');
  protected readonly serviceName = ServiceName.USER;

  constructor(
    protected readonly client: ClientProxy,
    protected override readonly sourceService: string,
  ) {
    super();
  }

  call<T>(pattern: string, payload?: unknown): Promise<T> {
    return this.send<T, unknown>(pattern, payload);
  }
}

describe('organization RPC over TCP (transport)', () => {
  let app: INestApplication;
  let tcp: ClientProxy;
  let fromInvoice: TestClient;
  const organizationService = { invoiceSettings: jest.fn(), findAll: jest.fn() };

  const as = <T>(identity: Partial<CorrelationContext>, call: () => Promise<T>) =>
    runWithCorrelationContext({ correlationId: 'transport-spec', traceId: 'transport-spec', ...identity }, call);

  beforeAll(async () => {
    const port = await freePort();
    const moduleRef = await Test.createTestingModule({
      controllers: [OrganizationRpcController],
      providers: [RpcPermissionGuard, { provide: OrganizationService, useValue: organizationService }],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalInterceptors(new RpcLoggingInterceptor(), new RpcExceptionInterceptor());
    app.useGlobalGuards(app.get(RpcPermissionGuard));
    const tcpConfig = createTcpServerConfig(ServiceName.USER);
    app.connectMicroservice<MicroserviceOptions>(
      { ...tcpConfig, options: { ...tcpConfig.options, host: '127.0.0.1', port } },
      { inheritAppConfig: true },
    );
    await app.startAllMicroservices();
    await app.init();

    tcp = ClientProxyFactory.create({ transport: Transport.TCP, options: { host: '127.0.0.1', port } });
    fromInvoice = new TestClient(tcp, 'invoice');
  });

  // Servers before clients: see CLAUDE.md's transport-layer note.
  afterAll(async () => {
    await app?.close();
    await tcp?.close();
  });

  beforeEach(() => jest.clearAllMocks());

  // Numbering runs with or without an end user behind it (invoice's internal API, scheduled issuing).
  it('serves INVOICE_SETTINGS to a service call with no user, for the organization the envelope carries', async () => {
    organizationService.invoiceSettings.mockResolvedValue({ invoicePrefix: 'ACME' });

    await expect(
      as({ organizationId: 'org-acme' }, () => fromInvoice.call(TCP_PATTERNS.ORGANIZATION.INVOICE_SETTINGS)),
    ).resolves.toEqual({ invoicePrefix: 'ACME' });
    expect(organizationService.invoiceSettings).toHaveBeenCalledWith('org-acme');
  });

  // The organization is never taken from the payload, so a caller can't point it at another tenant.
  it('ignores an organization id in the payload', async () => {
    organizationService.invoiceSettings.mockResolvedValue({ invoicePrefix: 'ACME' });

    await as({ organizationId: 'org-acme' }, () =>
      fromInvoice.call(TCP_PATTERNS.ORGANIZATION.INVOICE_SETTINGS, { id: 'org-other', organizationId: 'org-other' }),
    );

    expect(organizationService.invoiceSettings).toHaveBeenCalledWith('org-acme');
  });

  it('still refuses the rest of the controller to a call with no user (401)', async () => {
    await expect(
      as({ organizationId: 'org-acme' }, () => fromInvoice.call(TCP_PATTERNS.ORGANIZATION.FIND_ALL, {})),
    ).rejects.toMatchObject({ status: 401 });
    expect(organizationService.findAll).not.toHaveBeenCalled();
  });
});
