import type { PaginationMeta } from '@libs/shared/types';

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
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** An organization's admin changing its own settings (PATCH /organization). */
export interface UpdateCurrentOrganizationRequest {
  name?: string;
  invoicePrefix?: string;
  reminderOffsetsDays?: number[];
}

/** What invoice needs to number and chase an organization's invoices -- nothing else about the tenant. */
export interface OrganizationInvoiceSettings {
  invoicePrefix: string;
  reminderOffsetsDays: number[];
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
