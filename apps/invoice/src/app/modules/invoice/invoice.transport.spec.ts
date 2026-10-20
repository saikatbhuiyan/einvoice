import { ConflictException, HttpException, Logger, type INestApplication } from '@nestjs/common';
import { ClientProxyFactory, Transport, type ClientProxy, type MicroserviceOptions } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { RpcPermissionGuard } from '@libs/auth/rpc-permission.guard';
import { RpcExceptionInterceptor, RpcLoggingInterceptor } from '@libs/interceptors';
import { getCurrentCorrelationContext, runWithCorrelationContext, type CorrelationContext } from '@libs/logging';
import { BaseTcpClient, createTcpServerConfig, ServiceName, TCP_PATTERNS } from '@libs/transports';
import { freePort } from '@libs/transports/transport-test-harness';
import { InvoiceRpcController } from './invoice-rpc.controller';
import { InvoiceService } from './invoice.service';

/**
 * Transport test: invoice's real RPC controller over a real TCP socket, with the global guard and
 * interceptors main.ts registers. Only InvoiceService is stubbed. Calls go through a real
 * BaseTcpClient — the class bff's and payment's invoice clients extend — so the status a caller
 * sees is the one its own error mapping produces, not a hand-built expectation.
 */
class TestInvoiceClient extends BaseTcpClient {
  protected readonly logger = new Logger('TestInvoiceClient');
  protected readonly serviceName = ServiceName.INVOICE;

  constructor(
    protected readonly client: ClientProxy,
    protected override readonly sourceService: string,
  ) {
    super();
  }

  call<T>(pattern: string, id: string): Promise<T> {
    return this.send<T, { id: string }>(pattern, { id });
  }
}

const ORG = 'org-acme';
const WRITER = { userId: 'kc-user-1', organizationId: ORG, permissions: ['invoice:write'] };
const READER = { userId: 'kc-user-2', organizationId: ORG, permissions: ['invoice:read'] };
const ID = '507f1f77bcf86cd799439011';

describe('invoice lifecycle over TCP (transport)', () => {
  let app: INestApplication;
  let tcp: ClientProxy;
  let fromBff: TestInvoiceClient;
  let fromPayment: TestInvoiceClient;
  let seenContext: CorrelationContext | undefined;

  const invoiceService = {
    getPdfDownloadUrl: jest.fn(),
    issue: jest.fn(),
    cancel: jest.fn(),
    send: jest.fn(),
    markPaid: jest.fn(),
  };

  // As the caller: identity on the correlation context is what createRpcEnvelope puts on the wire.
  const as = <T>(identity: Partial<CorrelationContext>, call: () => Promise<T>) =>
    runWithCorrelationContext({ correlationId: 'transport-spec', traceId: 'transport-spec', ...identity }, call);

  beforeAll(async () => {
    const port = await freePort();

    const moduleRef = await Test.createTestingModule({
      controllers: [InvoiceRpcController],
      providers: [RpcPermissionGuard, { provide: InvoiceService, useValue: invoiceService }],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalInterceptors(new RpcLoggingInterceptor(), new RpcExceptionInterceptor());
    app.useGlobalGuards(app.get(RpcPermissionGuard));

    const tcpConfig = createTcpServerConfig(ServiceName.INVOICE);
    app.connectMicroservice<MicroserviceOptions>(
      { ...tcpConfig, options: { ...tcpConfig.options, host: '127.0.0.1', port } },
      { inheritAppConfig: true },
    );
    await app.startAllMicroservices();
    await app.init();

    tcp = ClientProxyFactory.create({ transport: Transport.TCP, options: { host: '127.0.0.1', port } });
    fromBff = new TestInvoiceClient(tcp, 'bff');
    fromPayment = new TestInvoiceClient(tcp, 'payment');
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

  it.each([
    ['ISSUE', 'issue'],
    ['CANCEL', 'cancel'],
    ['SEND', 'send'],
  ] as const)('%s reaches the service for a caller with invoice:write', async (pattern, method) => {
    invoiceService[method].mockResolvedValue({ id: ID });

    await expect(as(WRITER, () => fromBff.call(TCP_PATTERNS.INVOICE[pattern], ID))).resolves.toEqual({ id: ID });
    expect(invoiceService[method]).toHaveBeenCalledWith(ID);
  });

  it.each(['ISSUE', 'CANCEL', 'SEND'] as const)(
    '%s is refused with 403 for a caller with only invoice:read',
    async (pattern) => {
      await expect(as(READER, () => fromBff.call(TCP_PATTERNS.INVOICE[pattern], ID))).rejects.toMatchObject({
        status: 403,
      });
      expect(invoiceService.issue).not.toHaveBeenCalled();
      expect(invoiceService.cancel).not.toHaveBeenCalled();
      expect(invoiceService.send).not.toHaveBeenCalled();
    },
  );

  it('GET_PDF_URL needs only invoice:read, and is refused without it', async () => {
    const link = { url: 'https://s3.test/signed', expiresAt: '2026-10-19T10:05:00.000Z', fileName: 'invoice.pdf' };
    invoiceService.getPdfDownloadUrl.mockResolvedValue(link);

    await expect(as(READER, () => fromBff.call(TCP_PATTERNS.INVOICE.GET_PDF_URL, ID))).resolves.toEqual(link);
    await expect(
      as({ userId: 'kc-user-3', organizationId: ORG, permissions: [] }, () =>
        fromBff.call(TCP_PATTERNS.INVOICE.GET_PDF_URL, ID),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  // Every repository query is scoped by the caller's organization; a tenant handler reached
  // without one must be refused at the boundary, not left to fail (or leak) further in.
  it('refuses a tenant call that carries no organization, even with the right permission', async () => {
    const writerWithoutOrganization = { ...WRITER, organizationId: undefined };

    await expect(
      as(writerWithoutOrganization, () => fromBff.call(TCP_PATTERNS.INVOICE.ISSUE, ID)),
    ).rejects.toMatchObject({ status: 403 });
    expect(invoiceService.issue).not.toHaveBeenCalled();
  });

  // payment's webhook path has no end user; the context the handler runs in still names the caller
  // (attributing the audit entry to `service:payment`) and the invoice's organization, which payment
  // recorded with the checkout session and which scopes the lookup.
  it("MARK_PAID is reachable from payment with no user, in the invoice's organization", async () => {
    invoiceService.markPaid.mockImplementation(async () => {
      seenContext = getCurrentCorrelationContext();
      return { id: ID, status: 'paid' };
    });

    await expect(
      as({ organizationId: ORG }, () => fromPayment.call(TCP_PATTERNS.INVOICE.MARK_PAID, ID)),
    ).resolves.toEqual({ id: ID, status: 'paid' });
    expect(seenContext).toMatchObject({ sourceService: 'payment', organizationId: ORG });
    expect(seenContext?.userId).toBeUndefined();
  });

  // payment acknowledges a webhook (instead of letting Stripe retry forever) only on a 404/409, so
  // the lifecycle refusal must arrive at the caller as exactly that status.
  it('delivers a lifecycle refusal to the caller as a 409 with its message', async () => {
    invoiceService.markPaid.mockRejectedValue(
      new ConflictException('Cannot mark as paid an invoice that is cancelled.'),
    );

    const error = await as({ organizationId: ORG }, () => fromPayment.call(TCP_PATTERNS.INVOICE.MARK_PAID, ID)).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(409);
    expect((error as HttpException).getResponse()).toMatchObject({
      message: 'Cannot mark as paid an invoice that is cancelled.',
    });
  });
});
