/**
 * SSLCommerz's v4 HTTP API, credentials passed per call (each organization has its own store).
 * Documented at https://developer.sslcommerz.com/doc/v4/; response shapes below were confirmed
 * against the public sandbox (see docs/phase-5a-sslcommerz-payments-plan.md).
 *
 * Framework-free on purpose: PaymentService decides what an answer means; this only talks HTTP.
 */

export interface SslCommerzCredentials {
  storeId: string;
  storePassword: string;
  sandbox: boolean;
}

/** SSLCommerz couldn't be reached, or answered with something we can't use: retry later. */
export class SslCommerzUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SslCommerzUnavailableError';
  }
}

/** SSLCommerz refused the request itself (wrong credentials, an inactive store, a bad amount). */
export class SslCommerzRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SslCommerzRejectedError';
  }
}

export interface SessionRequest {
  tranId: string;
  /** Taka with two decimals, e.g. "1380.50" (SSLCommerz takes the major unit, not poisha). */
  totalAmount: string;
  currency: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
  productName: string;
  customer: { name: string; email: string; phone?: string; address?: string };
  /** Echoed back unchanged in IPNs and validation answers. */
  valueA?: string;
}

export interface Session {
  sessionKey: string;
  gatewayUrl: string;
}

/** One payment attempt for a tran_id, as the transaction query reports it. */
export interface TransactionAttempt {
  status: string;
  valId: string;
}

/** The Validation API's answer for a val_id: the facts settlement checks. */
export interface ValidatedTransaction {
  /** VALID, VALIDATED (already validated before: idempotent) or INVALID_TRANSACTION. */
  status: string;
  tranId: string;
  valId: string;
  /** The order amount and currency as the payer was charged in (before any conversion to BDT). */
  amount: string;
  currency: string;
  /** "0" safe, "1" high risk (SSLCommerz advises holding the order). */
  riskLevel: string;
  riskTitle: string;
  /** A discount SSLCommerz applied (bank or store campaign), if any. */
  discountAmount?: string;
}

const TIMEOUT_MS = 15_000;

const host = (credentials: SslCommerzCredentials) =>
  credentials.sandbox ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';

export class SslCommerzClient {
  constructor(private readonly http: typeof fetch = fetch) {}

  async createSession(credentials: SslCommerzCredentials, request: SessionRequest): Promise<Session> {
    const form = new URLSearchParams({
      store_id: credentials.storeId,
      store_passwd: credentials.storePassword,
      total_amount: request.totalAmount,
      currency: request.currency,
      tran_id: request.tranId,
      success_url: request.successUrl,
      fail_url: request.failUrl,
      cancel_url: request.cancelUrl,
      ipn_url: request.ipnUrl,
      cus_name: request.customer.name,
      cus_email: request.customer.email,
      shipping_method: 'NO',
      product_name: request.productName,
      product_category: 'Invoice',
      product_profile: 'non-physical-goods',
    });
    // Only what we know: SSLCommerz's hosted page collects the rest from the payer.
    if (request.customer.phone) form.set('cus_phone', request.customer.phone);
    if (request.customer.address) form.set('cus_add1', request.customer.address);
    if (request.valueA) form.set('value_a', request.valueA);

    const body = await this.call(`${host(credentials)}/gwprocess/v4/api.php`, { method: 'POST', body: form });
    if (body['status'] !== 'SUCCESS' || typeof body['GatewayPageURL'] !== 'string' || !body['GatewayPageURL']) {
      throw new SslCommerzRejectedError(
        `SSLCommerz refused the payment session: ${String(body['failedreason'] || 'no reason given')}.`,
      );
    }
    return { sessionKey: String(body['sessionkey'] ?? ''), gatewayUrl: body['GatewayPageURL'] };
  }

  /** Every payment attempt SSLCommerz has for this tran_id. Throws when the store credentials are refused. */
  async queryTransaction(credentials: SslCommerzCredentials, tranId: string): Promise<TransactionAttempt[]> {
    const body = await this.call(
      `${host(credentials)}/validator/api/merchantTransIDvalidationAPI.php?${new URLSearchParams({
        tran_id: tranId,
        store_id: credentials.storeId,
        store_passwd: credentials.storePassword,
        format: 'json',
      })}`,
    );
    if (body['APIConnect'] !== 'DONE') {
      // FAILED is what wrong credentials or an inactive store get; anything else is an outage.
      throw body['APIConnect'] === 'FAILED'
        ? new SslCommerzRejectedError('SSLCommerz refused the store credentials (wrong, or the store is inactive).')
        : new SslCommerzUnavailableError(
            `SSLCommerz transaction query answered APIConnect=${String(body['APIConnect'])}.`,
          );
    }
    const elements = Array.isArray(body['element']) ? (body['element'] as Record<string, unknown>[]) : [];
    return elements.map((element) => ({
      status: String(element['status'] ?? ''),
      valId: String(element['val_id'] ?? ''),
    }));
  }

  async validate(credentials: SslCommerzCredentials, valId: string): Promise<ValidatedTransaction> {
    const body = await this.call(
      `${host(credentials)}/validator/api/validationserverAPI.php?${new URLSearchParams({
        val_id: valId,
        store_id: credentials.storeId,
        store_passwd: credentials.storePassword,
        format: 'json',
      })}`,
    );
    const text = (key: string) => (body[key] === undefined || body[key] === null ? '' : String(body[key]));
    return {
      status: text('status'),
      tranId: text('tran_id'),
      valId: text('val_id'),
      // currency_type/currency_amount are what the order was in; currency/amount can be the BDT conversion.
      amount: text('currency_amount') || text('amount'),
      currency: text('currency_type') || text('currency'),
      riskLevel: text('risk_level'),
      riskTitle: text('risk_title'),
      discountAmount: text('discount_amount') || undefined,
    };
  }

  /** Whether SSLCommerz accepts these store credentials, by a query that changes nothing. */
  async checkCredentials(credentials: SslCommerzCredentials): Promise<boolean> {
    try {
      await this.queryTransaction(credentials, `credential-check-${Date.now()}`);
      return true;
    } catch (error) {
      if (error instanceof SslCommerzRejectedError) return false;
      throw error;
    }
  }

  private async call(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.http(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new SslCommerzUnavailableError(`SSLCommerz could not be reached: ${(error as Error).message}`);
    }
    if (!response.ok) {
      throw new SslCommerzUnavailableError(`SSLCommerz answered HTTP ${response.status}.`);
    }
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new SslCommerzUnavailableError('SSLCommerz answered with something other than JSON.');
    }
  }
}
