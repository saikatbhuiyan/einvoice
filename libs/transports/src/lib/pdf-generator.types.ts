// Payload shapes for PDF_GENERATOR_PATTERNS.GENERATE_INVOICE_PDF. pdf-generator has no database
// of its own, so invoice sends the already-fetched invoice data as a plain object rather than an
// id — a stateless renderer has no reason to call back into invoice's Mongo just to re-fetch what
// the caller already had in hand.

export interface GenerateInvoicePdfClientSnapshot {
  name: string;
  email: string;
  address?: string;
}

export interface GenerateInvoicePdfItem {
  catalogId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  total: number;
}

export interface GenerateInvoicePdfRequest {
  invoiceNumber: string;
  client: GenerateInvoicePdfClientSnapshot;
  items: GenerateInvoicePdfItem[];
  currency: string;
  status: string;
  issueDate: string;
  dueDate?: string;
  notes?: string;
  subtotal: number;
  vatTotal: number;
  total: number;
}

export interface GenerateInvoicePdfResponse {
  fileName: string;
  contentType: string;
  /** Base64-encoded PDF bytes — TCP payloads are JSON, so a raw Buffer can't cross the wire as-is. */
  base64: string;
}
