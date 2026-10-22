// Payload shapes for PDF_GENERATOR_PATTERNS.GENERATE_INVOICE_PDF. pdf-generator has no database
// of its own, so invoice sends the already-fetched invoice data as a plain object rather than an
// id — a stateless renderer has no reason to call back into invoice's Mongo just to re-fetch what
// the caller already had in hand.

export interface GenerateInvoicePdfClientSnapshot {
  name: string;
  email: string;
  address?: string;
  /** Bangladesh BIN of a registered buyer. */
  bin?: string;
}

/** The issuing organization (as of issue; for a draft, as it is now). */
export interface GenerateInvoicePdfSeller {
  name: string;
  bin?: string;
  /** The challan-issuing address. */
  address?: string;
  authorizedSignatory?: { name: string; designation: string };
}

/**
 * Which document to render. invoice decides (it owns the rule: a BDT invoice from an organization
 * with a BIN is a Mushak-6.3 tax invoice); pdf-generator only lays it out.
 */
export const DOCUMENT_FORMATS = ['standard', 'mushak-6.3'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/** Amounts are integers in the currency's minor unit (poisha, cents); the renderer formats them. */
export interface GenerateInvoicePdfItem {
  catalogId: string;
  name: string;
  /** Unit of supply ("pcs", "kg"). */
  unit?: string;
  quantity: number;
  unitPriceMinor: number;
  vatRate: number;
  sdRate: number;
  netMinor: number;
  sdMinor: number;
  vatMinor: number;
  totalMinor: number;
}

export interface GenerateInvoicePdfRequest {
  /** Absent from requests made before formats existed: 'standard'. */
  format?: DocumentFormat;
  invoiceNumber: string;
  seller?: GenerateInvoicePdfSeller;
  /** IANA zone the date and time of issue are printed in. Absent: UTC. */
  timeZone?: string;
  client: GenerateInvoicePdfClientSnapshot;
  items: GenerateInvoicePdfItem[];
  currency: string;
  status: string;
  /** The instant of issue (ISO-8601); printed as a date and time in `timeZone`. */
  issueDate: string;
  dueDate?: string;
  notes?: string;
  netMinor: number;
  sdMinor: number;
  vatMinor: number;
  totalMinor: number;
}

export interface GenerateInvoicePdfResponse {
  fileName: string;
  contentType: string;
  /** Base64-encoded PDF bytes — TCP payloads are JSON, so a raw Buffer can't cross the wire as-is. */
  base64: string;
}
