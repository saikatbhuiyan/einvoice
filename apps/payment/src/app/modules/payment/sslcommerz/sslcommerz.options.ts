/** SSLCommerz settings, injected (built from CONFIGURATION by PaymentModule) so nothing here loads the environment on import. */
export const SSLCOMMERZ_OPTIONS = Symbol('SSLCOMMERZ_OPTIONS');

export interface SslCommerzOptions {
  /** 32 bytes, base64: encrypts stored store passwords. Unset: SSLCommerz is off (503). */
  credentialsKey?: string;
  /** bff's public API base, where payers return and IPNs arrive. Unset: no SSLCommerz checkouts (503). */
  publicBaseUrl?: string;
}
