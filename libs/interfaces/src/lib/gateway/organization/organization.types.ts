import type { AuthorizedSignatory, PaginationMeta } from '@libs/shared/types';

export interface CreateOrganizationAdminRequest {
  email: string;
  name: string;
}

export interface CreateOrganizationRequest {
  name: string;
  /** Lower-case letters, digits and hyphens; globally unique. */
  slug: string;
  /** Prefix of the organization's invoice numbers. Defaults to "INV". */
  invoicePrefix?: string;
  /** The organization's first administrator (an existing person is added, a new one is created). */
  admin: CreateOrganizationAdminRequest;
}

export interface FindAllOrganizationsRequest {
  page?: number;
  limit?: number;
  search?: string;
}

export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  invoicePrefix: string;
  /** Payment reminders: days after an invoice's due date. Empty = no reminders. */
  reminderOffsetsDays: number[];
  /** Bangladesh Business Identification Number (13 digits). With one, BDT invoices are Mushak-6.3. */
  bin: string | null;
  /** The challan-issuing address printed on tax invoices. Required once there is a BIN. */
  address: string | null;
  /** IANA zone for printed dates and times and for the invoice-number year. */
  timeZone: string;
  /** The officer-in-charge printed on tax invoices. */
  authorizedSignatory: AuthorizedSignatory | null;
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** An organization's admin changing its own settings (PATCH /organization). */
export interface UpdateCurrentOrganizationRequest {
  name?: string;
  invoicePrefix?: string;
  reminderOffsetsDays?: number[];
  /** null removes it. Setting one also sets timeZone to Asia/Dhaka unless the organization or this request has another. */
  bin?: string | null;
  address?: string | null;
  timeZone?: string;
  authorizedSignatory?: AuthorizedSignatory | null;
}

/** Who issues an organization's tax invoices, as invoice snapshots it onto each one when issued. */
export interface OrganizationTaxIdentity {
  name: string;
  bin: string | null;
  address: string | null;
  authorizedSignatory: AuthorizedSignatory | null;
}

/** What invoice needs to number and chase an organization's invoices -- nothing else about the tenant. */
export interface OrganizationInvoiceSettings {
  invoicePrefix: string;
  reminderOffsetsDays: number[];
  timeZone: string;
  issuer: OrganizationTaxIdentity;
}

export interface FindAllOrganizationsResponse {
  items: OrganizationResponse[];
  meta: PaginationMeta;
}

export interface OrganizationIdGatewayRequest {
  id: string;
}

export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  roleName: string;
}

/** GET /me: who the caller is, where they belong, and which organization this request acted in. */
export interface CurrentCallerResponse {
  userId: string;
  username: string;
  email?: string;
  /** Set when the request resolved to one organization (header given, or only one membership). */
  activeOrganizationId?: string;
  memberships: MembershipSummary[];
  permissions: string[];
}
